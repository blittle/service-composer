/**
 * Service Worker Composer v1.1.0
 * A utility for composing service worker caching.
 *
 * Copyright Bret Little MIT License
 *
 */
! function(glob) {

	var serviceComposer = {
		/**
		 * Only two types are currently supported. Add custom types by extending
		 * serviceComposer.types and serviceComposer.evaluators
		 */
		types: {
			CACHE_ALWAYS: 1,
			CACHE_OFFLINE: 2
		},

		/**
		 * The main method to start caching requests within the service worker
		 *
		 * @param {Array} evaluatorConfigList - Expects an array of configuration objects. Each
		 *												configuration object is expected to have a name, version, and type
		 *												attribute. The types must come from the above list of composer types.
		 */
		compose: function(evaluatorConfigList) {
			clearUnusedCaches(evaluatorConfigList);
			initializeEvents(evaluatorConfigList);
		}
	};

	/**
	 * Delete all caches that do not exist within the current config or have an out of date version.
	 */
	function clearUnusedCaches(evaluatorConfigList) {

		// The activate event fires when the service worker boots up.
		self.addEventListener('activate', function(event) {
			var expectedCacheNames = evaluatorConfigList.map(function(config) {
				return (config.name + '-' + config.version);
			});

			event.waitUntil(
				caches.keys().then(function(cacheNames) {
					return Promise.all(
						cacheNames.map(function(cacheName) {
							if (expectedCacheNames.indexOf(cacheName) == -1) {
								// If this cache name isn't present in the array of "expected" cache names, then delete it.
								console.log('Deleting out of date cache:', cacheName);
								return caches.delete(cacheName);
							}
						})
					);
				})
			);
		});
	}

	/**
	 * Match a request url with either a string or a regular expression. If the matcher
	 * is falsy then always return true. This allows a evaluator to match all requests.
	 */
	function urlMatches(matcher, url) {
		if (!matcher) return true;

		if (matcher instanceof String || typeof matcher === 'string') {
			return url.indexOf(matcher) === 0;
		} else if (matcher instanceof RegExp) {
			return !!url.match(matcher);
		}
	}

	/**
	 * Execute a given evaluator from a configuration object
	 */
	function executeEvaluator(evaluatorConfig, event) {
		var cacheEventFound = false;
		Object.keys(serviceComposer.types).forEach(function(key) {
			if (serviceComposer.types[key] === evaluatorConfig.type) {
				if (typeof evaluatorConfig.evaluator === 'function') {
					// Use a custom evaluator method
					evaluatorConfig.evaluator.call(null, event, evaluatorConfig);
				} else {
					// Use a default evaluator method
					evaluators[key](event, evaluatorConfig);
				}
				cacheEventFound = true;
			}
		});
		if (!cacheEventFound) {
			throw new Error("Invalid configuration type", evaluatorConfig.type)
		}
	}

	function initializeEvents(evaluatorConfigList) {
		// Intercept all XHR requests
		self.addEventListener('fetch', function(event) {
			var url = event.request.url;

			for (var i = 0, iLength = evaluatorConfigList.length; i < iLength; i++) {
				var evaluatorConfig = evaluatorConfigList[i];
				var matcher = evaluatorConfig.matcher;

				if (urlMatches(matcher, url)) {
					executeEvaluator(evaluatorConfig, event);
					break; // once the first evaluator is found, skip all others. Maybe change to allow multiple?
				}
			}
		});
	}


	var evaluators = serviceComposer.evaluators = {
		CACHE_ALWAYS: function(event, evaluatorConfig) {
			event.respondWith(
				caches.open(evaluatorConfig.name + '-' + evaluatorConfig.version).then(function(cache) {
					return cache.match(event.request).then(function(response) {
						if (response) {
							// If there is an entry in the cache for event.request, then response will be defined
							// and we can just return it.
							console.log(' Found response in cache:', response);

							return response;
						} else {
							// Otherwise, if there is no entry in the cache for event.request, response will be
							// undefined, and we need to fetch() the resource.
							console.log(' No response for %s found in cache. About to fetch from network...', event.request.url);

							// We call .clone() on the request since we might use it in the call to cache.put() later on.
							// Both fetch() and cache.put() "consume" the request, so we need to make a copy.
							// (see https://fetch.spec.whatwg.org/#dom-request-clone)
							return fetch(event.request.clone()).then(function(response) {
								console.log('  Response for %s from network is: %O', event.request.url, response);

								// Optional: add in extra conditions here, e.g. response.type == 'basic' to only cache
								// responses from the same domain. See https://fetch.spec.whatwg.org/#concept-response-type
								if (response.status < 400 && response.ok) {
									if (typeof evaluatorConfig.onSuccess === 'function') {
										evaluatorConfig.onSuccess.call(null, response, cache, event, evaluatorConfig)
									}
									// This avoids caching responses that we know are errors (i.e. HTTP status code of 4xx or 5xx).
									// One limitation is that, for non-CORS requests, we get back a filtered opaque response
									// (https://fetch.spec.whatwg.org/#concept-filtered-response-opaque) which will always have a
									// .status of 0, regardless of whether the underlying HTTP call was successful. Since we're
									// blindly caching those opaque responses, we run the risk of caching a transient error response.
									//
									// We need to call .clone() on the response object to save a copy of it to the cache.
									// (https://fetch.spec.whatwg.org/#dom-request-clone)
									cache.put(event.request, response.clone());
								}

								// Return the original response object, which will be used to fulfill the resource request.
								return response;
							});
						}
					}).catch(function(error) {
						// This catch() will handle exceptions that arise from the match() or fetch() operations.
						// Note that a HTTP error response (e.g. 404) will NOT trigger an exception.
						// It will return a normal response object that has the appropriate error code set.
						console.error('  Read-through caching failed:', error);

						throw error;
					});
				})
			);
		},

		CACHE_OFFLINE: function(event, evaluatorConfig) {
			event.respondWith(
				caches.open(evaluatorConfig.name + '-' + evaluatorConfig.version).then(function(cache) {
					return fetch(event.request.clone()).then(function(response) {
						if (response.status < 400) {
							if (typeof evaluatorConfig.onSuccess === 'function') {
								// Execute a success handler
								evaluatorConfig.onSuccess.call(null, response, cache, event, evaluatorConfig)
							}
							cache.put(event.request, response.clone());
							return response;
						} else {
							return cache.match(event.request.clone()).then(function(response) {
								if (response) {
									return response;
								} else {
									throw new Error();
								}
							}).catch(function(error) {
								console.error('  Read-through caching failed:', error);
								throw error;
							});
						}
					}).catch(function(error) {
						return cache.match(event.request.clone()).then(function(response) {
							if (response) {
								return response;
							} else {
								throw error;
							}
						}).catch(function(error) {
							console.error('  Read-through caching failed:', error);
							throw error;
						});
					});
				})
			);
		}
	};

	glob.serviceComposer = serviceComposer;
}(this);
