# Service Worker Composer
A utility for composing Service Worker caching

## Installation
Download `service-composer.js` and put it into your project. You may also need the [Service Worker Cache Polyfill](https://github.com/coonsta/cache-polyfill)

Conditionally startup your service worker:
```javascript
if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register('/service-worker.js').then(function(registration) {
		// Registration was successful
		console.log('ServiceWorker registration successful with scope: ',    registration.scope);
	}).catch(function(err) {
		// registration failed :(
		console.log('ServiceWorker registration failed: ', err);
	});
})}
```

Within your service worker, import the cache polyfill along with service-compoeser.js:
```javascript
importScripts('serviceworker-cache-polyfill.js', 'service-composer.js');
```

## Usage
Service-composer allows you to easily setup caching policies based upon url matchers. An example:

The composer takes an array of configuration objects. Each http request is matched
with these configuration objects in the order. Only the first one to match is resolved.

### Configuration parameters:
#### name - required
The name, along with the version, is used to identify the cache. If the name is "images" and the version is "1"
then a cache with be identified as "images-1". Each time the service worker starts up, all caches are validated
and those that are incorrect versions or are unknown are deleted.

#### version - required
Used to identify the cache. Update the version when you want to clear the cache.

#### type - required
Currently only two types are supported serviceComposer.types.CACHE_ALWAYS and serviceComposer.types.CACHE_OFFLINE

CACHE_ALWAYS - shold be used for resources (like images) that you always want to cache and serve from cache regardless
of the offline state.

CACHE_OFFLINE - should be used for resources that you only want to serve from the cache when you are offline. When you are
online requests never be served from cache. Each subsequent request is placed into the cache for future availability.

Note: You can extend service-composer by extending serviceComposer.types and adding a corresponding implementation to
serviceComposer.evaluators

#### matcher - optional
The matcher can be a string or regular expression. The matcher is evaluated on each request url and used to determine
if which cache config to use. If it is a string, it needs to match the zeroeth index of the request url.

#### onSuccess - optional
An optional function to evaluate on a successful request. The function is passed: (response, cache, event, config)

#### evaluator - optional
Provide a custom evaluator which will be passed the config and event object. Use this if you want to implement
your own caching functionality outside the types available by default.

### Example:
```javascript
importScripts('serviceworker-cache-polyfill.js');
importScripts('service-composer.js');

serviceComposer.compose([
  {
		name: 'images',
		version: 1,
		matcher: 'https://www.apod.io/images',
		type: serviceComposer.types.CACHE_ALWAYS
	},
	{
		name: 'others',
		version: 1,
		type: serviceComposer.types.CACHE_OFFLINE,
		onSuccess: function(response, cache, event, config) {
			if(event.request.url.indexOf('page=') > -1) {
				prefetchImages(response.clone());
			}
		}
	}
]);

function prefetchImages(response) {
	response.json().then(function(json) {
		var urls = json.map(function(obj) {
			return obj.localImages.medPath;
		});

		caches.open('images-1').then(function(cache) {
			cache.addAll(urls);
		});
	});
}
```

