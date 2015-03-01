!function(glob) {

  /**
   * Delete all caches that do not exist within the current config or have an
   * out of date version.
   */
  function clearUnusedCaches(cacheConfig) {
    self.addEventListener('activate', function(event) {
      var expectedCacheNames = cacheConfig.map(function(config) {
        return (config.name + '-' + config.version );
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

  function urlMatches(matcher, url) {
    if(!matcher) return true;

    if(matcher instanceof String || typeof matcher === 'string') {
      return url.indexOf(matcher) === 0;
    } else if(matcher instanceof RegExp) {
      return !!url.match(matcher);
    }
  }

  function setupCacheEvents(config, event) {
    var cacheEventFound = false;
    Object.keys(serviceComposer.types).forEach(function(key) {
      if(serviceComposer.types[key] === config.type) {
        handlers[key](config, event);
        cacheEventFound = true;
      }
    });
    if(!cacheEventFound) {
      throw new Error("Invalid configuration type", config.type)
    }
  }

  function initializeEvents(cacheConfig) {
    self.addEventListener('fetch', function(event) {
      var url = event.request.url;

      for(var i = 0, iLength = cacheConfig.length; i < iLength; i++) {
        var config = cacheConfig[i];
        var matcher = config.matcher;

        if(urlMatches(matcher, url)) {
          setupCacheEvents(config, event);
          break; // once the first matcher is found, skip all others
        }
      }

    });
  }


  var handlers = {
    CACHE_ALWAYS: function(config, event) {
      event.respondWith(
        caches.open(config.name + '-' + config.version).then(function(cache) {
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
                  // Execute a custom evaluator
                  if(typeof config.customEvaluator === 'function' ) {
                    config.customEvaluator.call(null, response, cache, event, config)
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

    CACHE_OFFLINE: function(config, event) {
      event.respondWith(
        caches.open(config.name + '-' + config.version).then(function(cache) {
          return fetch(event.request.clone()).then(function(response) {
            if(response.status < 400) {
              // Execute a custom evaluator
              if(typeof config.customEvaluator === 'function' ) {
                config.customEvaluator.call(null, response, cache, event, config)
              }
              cache.put(event.request, response.clone());
              return response;
            } else {
              return cache.match(event.request).then(function(response) {
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
              return cache.match(event.request).then(function(response) {
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

  var serviceComposer = {
    types: {
      CACHE_ALWAYS: 1,
      CACHE_OFFLINE: 2
    },

    compose: function(config) {
      clearUnusedCaches(config);
      initializeEvents(config);
    }
  };

  glob.serviceComposer = serviceComposer;
}(this);
