/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.11 Copyright (c) 2010-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.11',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value === 'object' && value &&
                        !isArray(value) && !isFunction(value) &&
                        !(value instanceof RegExp)) {

                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that is expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                bundles: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            bundlesMap = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part, length = ary.length;
            for (i = 0; i < length; i++) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgMain, mapValue, nameParts, i, j, nameSegment, lastIndex,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    //Convert baseName to array, and lop off the last part,
                    //so that . matches that 'directory' and not name of the baseName's
                    //module. For instance, baseName of 'one/two/three', maps to
                    //'one/two/three.js', but we want the directory, 'one/two' for
                    //this normalization.
                    normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    name = name.split('/');
                    lastIndex = name.length - 1;

                    // If wanting node ID compatibility, strip .js from end
                    // of IDs. Have to do this here, and not in nameToUrl
                    // because node allows either .js or non .js to map
                    // to same file.
                    if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                        name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                    }

                    name = normalizedBaseParts.concat(name);
                    trimDots(name);
                    name = name.join('/');
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                outerLoop: for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break outerLoop;
                                }
                            }
                        }
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            // If the name points to a package's name, use
            // the package main instead.
            pkgMain = getOwn(config.pkgs, name);

            return pkgMain ? pkgMain : name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return (defined[mod.map.id] = mod.exports);
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            return  getOwn(config.config, mod.map.id) || {};
                        },
                        exports: mod.exports || (mod.exports = {})
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                var map = mod.map,
                    modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            // Favor return value over exports. If node/cjs in play,
                            // then will not have a return value anyway. Favor
                            // module.exports assignment over exports object.
                            if (this.map.isDefine && exports === undefined) {
                                cjsModule = this.module;
                                if (cjsModule) {
                                    exports = cjsModule.exports;
                                } else if (this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        bundleId = getOwn(bundlesMap, this.map.id),
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    //If a paths config, then just load that file instead to
                    //resolve the plugin, as it is built into that paths layer.
                    if (bundleId) {
                        this.map.url = context.nameToUrl(bundleId);
                        this.load();
                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths since they require special processing,
                //they are additive.
                var shim = config.shim,
                    objs = {
                        paths: true,
                        bundles: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (!config[prop]) {
                            config[prop] = {};
                        }
                        mixin(config[prop], value, true, true);
                    } else {
                        config[prop] = value;
                    }
                });

                //Reverse map the bundles
                if (cfg.bundles) {
                    eachProp(cfg.bundles, function (value, prop) {
                        each(value, function (v) {
                            if (v !== prop) {
                                bundlesMap[v] = prop;
                            }
                        });
                    });
                }

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location, name;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;

                        name = pkgObj.name;
                        location = pkgObj.location;
                        if (location) {
                            config.paths[name] = pkgObj.location;
                        }

                        //Save pointer to main module ID for pkg name.
                        //Remove leading dot in main, so main paths are normalized,
                        //and remove any trailing .js, since different package
                        //envs have different conventions: some use a module name,
                        //some use a file name.
                        config.pkgs[name] = pkgObj.name + '/' + (pkgObj.main || 'main')
                                     .replace(currDirRegExp, '')
                                     .replace(jsSuffixRegExp, '');
                    });
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        //Clean queued defines too. Go backwards
                        //in array so that the splices do not
                        //mess up the iteration.
                        eachReverse(defQueue, function(args, i) {
                            if(args[0] === id) {
                                defQueue.splice(i, 1);
                            }
                        });

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overridden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, syms, i, parentModule, url,
                    parentPath, bundleId,
                    pkgMain = getOwn(config.pkgs, moduleName);

                if (pkgMain) {
                    moduleName = pkgMain;
                }

                bundleId = getOwn(bundlesMap, moduleName);

                if (bundleId) {
                    return context.nameToUrl(bundleId, ext, skipExt);
                }

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');

                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));;/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */
define('mixins', [
    'module'
], function (module) {
    'use strict';

    var rjsMixins;

    /**
     * Checks if specified string contains
     * a plugin spacer '!' substring.
     *
     * @param {String} name - Name, path or alias of a module.
     * @returns {Boolean}
     */
    function hasPlugin(name) {
        return !!~name.indexOf('!');
    }

    /**
     * Adds 'mixins!' prefix to the specified string.
     *
     * @param {String} name - Name, path or alias of a module.
     * @returns {String} Modified name.
     */
    function addPlugin(name) {
        return 'mixins!' + name;
    }

    /**
     * Removes base url from the provided string.
     *
     * @param {String} url - Url to be processed.
     * @param {Object} config - Contexts' configuration object.
     * @returns {String} String without base url.
     */
    function removeBaseUrl(url, config) {
        var baseUrl = config.baseUrl || '',
            index = url.indexOf(baseUrl);

        if (~index) {
            url = url.substring(baseUrl.length - index);
        }

        return url;
    }

    /**
     * Extracts url (without baseUrl prefix)
     * from a modules' name.
     *
     * @param {String} name - Name, path or alias of a module.
     * @param {Object} config - Contexts' configuartion.
     * @returns {String}
     */
    function getPath(name, config) {
        var url = require.toUrl(name);

        return removeBaseUrl(url, config);
    }

    /**
     * Checks if specified string represents a relative path (../).
     *
     * @param {String} name - Name, path or alias of a module.
     * @returns {Boolean}
     */
    function isRelative(name) {
        return !!~name.indexOf('./');
    }

    /**
     * Iterativly calls mixins passing to them
     * current value of a 'target' parameter.
     *
     * @param {*} target - Value to be modified.
     * @param {...Function} mixins
     * @returns {*} Modified 'target' value.
     */
    function applyMixins(target) {
        var mixins = Array.prototype.slice.call(arguments, 1);

        mixins.forEach(function (mixin) {
            target = mixin(target);
        });

        return target;
    }

    rjsMixins = {

        /**
         * Loads specified module along with its' mixins.
         *
         * @param {String} name - Module to be loaded.
         */
        load: function (name, req, onLoad, config) {
            var path     = getPath(name, config),
                mixins   = this.getMixins(path),
                deps     = [name].concat(mixins);

            req(deps, function () {
                onLoad(applyMixins.apply(null, arguments));
            });
        },

        /**
         * Retrieves list of mixins associated with a specified module.
         *
         * @param {String} path - Path to the module (without base url).
         * @returns {Array} An array of paths to mixins.
         */
        getMixins: function (path) {
            var config = module.config() || {},
                mixins = config[path] || {};

            return Object.keys(mixins).filter(function (mixin) {
                return mixins[mixin] !== false;
            });
        },

        /**
         * Checks if specified module has associated with it mixins.
         *
         * @param {String} path - Path to the module (without base url).
         * @returns {Boolean}
         */
        hasMixins: function (path) {
            return this.getMixins(path).length;
        },

        /**
         * Modifies provided names perpending to them
         * the 'mixins!' plugin prefix if it's necessary.
         *
         * @param {(Array|String)} names - Module names, paths or aliases.
         * @param {Object} context - Current requirejs context.
         * @returns {Array|String}
         */
        processNames: function (names, context) {
            var config = context.config;

            /**
             * Prepends 'mixin' plugin to a single name.
             *
             * @param {String} name
             * @returns {String}
             */
            function processName(name) {
                var path = getPath(name, config);

                if (!hasPlugin(name) && (isRelative(name) || rjsMixins.hasMixins(path))) {
                    return addPlugin(name);
                }

                return name;
            }

            return typeof names !== 'string' ?
                names.map(processName) :
                processName(names);
        }
    };

    return rjsMixins;
});

require([
    'mixins'
], function (mixins) {
    'use strict';

    var originalRequire  = window.require,
        originalDefine   = window.define,
        contexts         = originalRequire.s.contexts,
        defContextName   = '_',
        hasOwn           = Object.prototype.hasOwnProperty,
        getLastInQueue;

    getLastInQueue =
        '(function () {' +
            'var queue  = globalDefQueue,' +
                'item   = queue[queue.length - 1];' +
            '' +
            'return item;' +
        '})();';

    /**
     * Returns property of an object if
     * it's not defined in it's prototype.
     *
     * @param {Object} obj - Object whose property should be retrieved.
     * @param {String} prop - Name of the property.
     * @returns {*} Value of the property or false.
     */
    function getOwn(obj, prop) {
        return hasOwn.call(obj, prop) && obj[prop];
    }

    /**
     * Overrides global 'require' method adding to it dependencies modfication.
     */
    window.require = function (deps, callback, errback, optional) {
        var contextName = defContextName,
            context,
            config;

        if (!Array.isArray(deps) && typeof deps !== 'string') {
            config = deps;

            if (Array.isArray(callback)) {
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);

        if (!context) {
            context = contexts[contextName] = require.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        deps = mixins.processNames(deps, context);

        return context.require(deps, callback, errback);
    };

    /**
     * Overrides global 'define' method adding to it dependencies modfication.
     */
    window.define = function (name, deps, callback) { // eslint-disable-line no-unused-vars
        var context     = getOwn(contexts, defContextName),
            result      = originalDefine.apply(this, arguments),
            queueItem   = require.exec(getLastInQueue),
            lastDeps    = queueItem && queueItem[1];

        if (Array.isArray(lastDeps)) {
            queueItem[1] = mixins.processNames(lastDeps, context);
        }

        return result;
    };

    /**
     * Copy properties of original 'require' method.
     */
    Object.keys(originalRequire).forEach(function (key) {
        require[key] = originalRequire[key];
    });

    /**
     * Copy properties of original 'define' method.
     */
    Object.keys(originalDefine).forEach(function (key) {
        define[key] = originalDefine[key];
    });

    window.requirejs = window.require;
});
;(function(require){
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    "shim": {
        "extjs/ext-tree": [
            "prototype"
        ],
        "extjs/ext-tree-checkbox": [
            "extjs/ext-tree",
            "extjs/defaults"
        ],
        "jquery/editableMultiselect/js/jquery.editable": [
            "jquery"
        ]
    },
    "bundles": {
        "js/theme": [
            "globalNavigation",
            "globalSearch",
            "modalPopup",
            "useDefault",
            "loadingPopup",
            "collapsable"
        ]
    },
    "map": {
        "*": {
            "translateInline":      "mage/translate-inline",
            "form":                 "mage/backend/form",
            "button":               "mage/backend/button",
            "accordion":            "mage/accordion",
            "actionLink":           "mage/backend/action-link",
            "validation":           "mage/backend/validation",
            "notification":         "mage/backend/notification",
            "loader":               "mage/loader_old",
            "loaderAjax":           "mage/loader_old",
            "floatingHeader":       "mage/backend/floating-header",
            "suggest":              "mage/backend/suggest",
            "mediabrowser":         "jquery/jstree/jquery.jstree",
            "tabs":                 "mage/backend/tabs",
            "treeSuggest":          "mage/backend/tree-suggest",
            "calendar":             "mage/calendar",
            "dropdown":             "mage/dropdown_old",
            "collapsible":          "mage/collapsible",
            "menu":                 "mage/backend/menu",
            "jstree":               "jquery/jstree/jquery.jstree",
            "details":              "jquery/jquery.details"
        }
    },
    "deps": [
        "js/theme",
        "mage/backend/bootstrap",
        "mage/adminhtml/globals"
    ],
    "paths": {
        "jquery/ui": "jquery/jquery-ui-1.9.2"
    }
};

require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    "waitSeconds": 0,
    "map": {
        "*": {
            "ko": "knockoutjs/knockout",
            "knockout": "knockoutjs/knockout",
            "mageUtils": "mage/utils/main",
            "rjsResolver": "mage/requirejs/resolver"
        }
    },
    "shim": {
        "jquery/jquery-migrate": ["jquery"],
        "jquery/jquery.hashchange": ["jquery", "jquery/jquery-migrate"],
        "jquery/jstree/jquery.hotkeys": ["jquery"],
        "jquery/hover-intent": ["jquery"],
        "mage/adminhtml/backup": ["prototype"],
        "mage/captcha": ["prototype"],
        "mage/common": ["jquery"],
        "mage/new-gallery": ["jquery"],
        "mage/webapi": ["jquery"],
        "jquery/ui": ["jquery"],
        "MutationObserver": ["es6-collections"],
        "tinymce": {
            "exports": "tinymce"
        },
        "moment": {
            "exports": "moment"
        },
        "matchMedia": {
            "exports": "mediaCheck"
        },
        "jquery/jquery-storageapi": {
            "deps": ["jquery/jquery.cookie"]
        }
    },
    "paths": {
        "jquery/validate": "jquery/jquery.validate",
        "jquery/hover-intent": "jquery/jquery.hoverIntent",
        "jquery/file-uploader": "jquery/fileUploader/jquery.fileupload-fp",
        "jquery/jquery.hashchange": "jquery/jquery.ba-hashchange.min",
        "prototype": "legacy-build.min",
        "jquery/jquery-storageapi": "jquery/jquery.storageapi.min",
        "text": "mage/requirejs/text",
        "domReady": "requirejs/domReady",
        "tinymce": "tiny_mce/tiny_mce_src"
    },
    "deps": [
        "jquery/jquery-migrate"
    ],
    "config": {
        "mixins": {
            "jquery/jstree/jquery.jstree": {
                "mage/backend/jstree-mixin": true
            }
        }
    }
};

require(['jquery'], function ($) {
    $.noConflict();
});

require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */
/*eslint no-unused-vars: 0*/
var config = {
    map: {
        '*': {
            'mediaUploader':  'Magento_Backend/js/media-uploader'
        }
    }
};

require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    paths: {
        'customer/template': "Magento_Customer/templates"
    },
    map: {
        '*': {
            addressTabs:            'Magento_Customer/edit/tab/js/addresses',
            dataItemDeleteButton:   'Magento_Customer/edit/tab/js/addresses',
            observableInputs:       'Magento_Customer/edit/tab/js/addresses'
        }
    } 
};
require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            systemMessageDialog: 'Magento_AdminNotification/system/notification',
            toolbarEntry:   'Magento_AdminNotification/toolbar_entry'
        }
    }
};
require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            folderTree: 'Magento_Cms/js/folder-tree'
        }
    }
};
require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            categoryForm:       'Magento_Catalog/catalog/category/form',
            newCategoryDialog:  'Magento_Catalog/js/new-category-dialog',
            categoryTree:       'Magento_Catalog/js/category-tree',
            productGallery:     'Magento_Catalog/js/product-gallery',
            baseImage:          'Magento_Catalog/catalog/base-image-uploader',
            productAttributes:  'Magento_Catalog/catalog/product-attributes'
        }
    },
    deps: [
        'Magento_Catalog/catalog/product'
    ]
};
require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            requireCookie: 'Magento_Cookie/js/require-cookie'
        }
    } 
};
require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            rolesTree: 'Magento_User/js/roles-tree'
        }
    } 
};
require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            orderEditDialog: 'Magento_Sales/order/edit/message'
        }
    }
};
require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    paths: {
        'ui/template': 'Magento_Ui/templates'
    },
    map: {
        '*': {
            uiElement:      'Magento_Ui/js/lib/core/element/element',
            uiCollection:   'Magento_Ui/js/lib/core/collection',
            uiComponent:    'Magento_Ui/js/lib/core/collection',
            uiClass:        'Magento_Ui/js/lib/core/class',
            uiEvents:       'Magento_Ui/js/lib/core/events',
            uiRegistry:     'Magento_Ui/js/lib/registry/registry',
            uiLayout:       'Magento_Ui/js/core/renderer/layout',
            buttonAdapter:  'Magento_Ui/js/form/button-adapter'
        }
    }
};

require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            groupedProduct: 'Magento_GroupedProduct/js/grouped-product'
        }
    }
};
require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */
/*eslint no-unused-vars: 0*/
var config = {
    map: {
        '*': {
            popupWindow:            'mage/popup-window',
            confirmRedirect:        'Magento_Security/js/confirm-redirect'
        }
    }
};

require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */
/*eslint no-unused-vars: 0*/
var config = {
    map: {
        '*': {
            newVideoDialog:  'Magento_ProductVideo/js/new-video-dialog',
            openVideoModal:  'Magento_ProductVideo/js/video-modal'
        }
    }
};

require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            transparent:            'Magento_Payment/transparent'
        }
    }
};
require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            integration: 'Magento_Integration/js/integration'
        }
    } 
};
require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            swatchesProductAttributes: 'Magento_Swatches/js/product-attributes',
            swatchesTypeChange: 'Magento_Swatches/js/type-change'
        }
    }
};

require.config(config);
})();
(function() {
/**
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */

var config = {
    map: {
        '*': {
            fptAttribute: 'Magento_Weee/js/fpt-attribute'
        }
    }
};
require.config(config);
})();



})(require);;/**
 *
 * Copyright © 2016 Magento. All rights reserved.
 * See COPYING.txt for license details.
 */
require([
    "Magento_Variable/variables",
    "mage/adminhtml/browser"
]);;// This is CodeMirror (http://codemirror.net), a code editor
// implemented in JavaScript on top of the browser's DOM.
//
// You can find some technical background for some of the code below
// at http://marijnhaverbeke.nl/blog/#cm-internals .

(function (mod) {

    this.CodeMirror = mod();
})(function () {
    "use strict";

    // BROWSER SNIFFING

    // Kludges for bugs and behavior differences that can't be feature
    // detected are enabled based on userAgent etc sniffing.

    var gecko = /gecko\/\d/i.test(navigator.userAgent);
    // ie_uptoN means Internet Explorer version N or lower
    var ie_upto10 = /MSIE \d/.test(navigator.userAgent);
    var ie_upto7 = ie_upto10 && (document.documentMode == null || document.documentMode < 8);
    var ie_upto8 = ie_upto10 && (document.documentMode == null || document.documentMode < 9);
    var ie_upto9 = ie_upto10 && (document.documentMode == null || document.documentMode < 10);
    var ie_11up = /Trident\/([7-9]|\d{2,})\./.test(navigator.userAgent);
    var ie = ie_upto10 || ie_11up;
    var webkit = /WebKit\//.test(navigator.userAgent);
    var qtwebkit = webkit && /Qt\/\d+\.\d+/.test(navigator.userAgent);
    var chrome = /Chrome\//.test(navigator.userAgent);
    var presto = /Opera\//.test(navigator.userAgent);
    var safari = /Apple Computer/.test(navigator.vendor);
    var khtml = /KHTML\//.test(navigator.userAgent);
    var mac_geMountainLion = /Mac OS X 1\d\D([8-9]|\d\d)\D/.test(navigator.userAgent);
    var phantom = /PhantomJS/.test(navigator.userAgent);

    var ios = /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent);
    // This is woefully incomplete. Suggestions for alternative methods welcome.
    var mobile = ios || /Android|webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile/i.test(navigator.userAgent);
    var mac = ios || /Mac/.test(navigator.platform);
    var windows = /win/i.test(navigator.platform);

    var presto_version = presto && navigator.userAgent.match(/Version\/(\d*\.\d*)/);
    if (presto_version)
        presto_version = Number(presto_version[1]);
    if (presto_version && presto_version >= 15) {
        presto = false;
        webkit = true;
    }
    // Some browsers use the wrong event properties to signal cmd/ctrl on OS X
    var flipCtrlCmd = mac && (qtwebkit || presto && (presto_version == null || presto_version < 12.11));
    var captureRightClick = gecko || (ie && !ie_upto8);

    // Optimize some code when these features are not used.
    var sawReadOnlySpans = false, sawCollapsedSpans = false;

    // EDITOR CONSTRUCTOR

    // A CodeMirror instance represents an editor. This is the object
    // that user code is usually dealing with.

    function CodeMirror(place, options) {
        if (!(this instanceof CodeMirror))
            return new CodeMirror(place, options);

        this.options = options = options || {};
        // Determine effective options based on given values and defaults.
        copyObj(defaults, options, false);
        setGuttersForLineNumbers(options);

        var doc = options.value;
        if (typeof doc == "string")
            doc = new Doc(doc, options.mode);
        this.doc = doc;

        var display = this.display = new Display(place, doc);
        display.wrapper.CodeMirror = this;
        updateGutters(this);
        themeChanged(this);
        if (options.lineWrapping)
            this.display.wrapper.className += " CodeMirror-wrap";
        if (options.autofocus && !mobile)
            focusInput(this);

        this.state = {
            keyMaps: [], // stores maps added by addKeyMap
            overlays: [], // highlighting overlays, as added by addOverlay
            modeGen: 0, // bumped when mode/overlay changes, used to invalidate highlighting info
            overwrite: false, focused: false,
            suppressEdits: false, // used to disable editing during key handlers when in readOnly mode
            pasteIncoming: false, cutIncoming: false, // help recognize paste/cut edits in readInput
            draggingText: false,
            highlight: new Delayed() // stores highlight worker timeout
        };

        // Override magic textarea content restore that IE sometimes does
        // on our hidden textarea on reload
        if (ie_upto10)
            setTimeout(bind(resetInput, this, true), 20);

        registerEventHandlers(this);

        var cm = this;
        runInOp(this, function () {
            cm.curOp.forceUpdate = true;
            attachDoc(cm, doc);

            if ((options.autofocus && !mobile) || activeElt() == display.input)
                setTimeout(bind(onFocus, cm), 20);
            else
                onBlur(cm);

            for (var opt in optionHandlers)
                if (optionHandlers.hasOwnProperty(opt))
                    optionHandlers[opt](cm, options[opt], Init);
            for (var i = 0; i < initHooks.length; ++i)
                initHooks[i](cm);
        });
    }

    // DISPLAY CONSTRUCTOR

    // The display handles the DOM integration, both for input reading
    // and content drawing. It holds references to DOM nodes and
    // display-related state.

    function Display(place, doc) {
        var d = this;

        // The semihidden textarea that is focused when the editor is
        // focused, and receives input.
        var input = d.input = elt("textarea", null, null, "position: absolute; padding: 0; width: 1px; height: 1em; outline: none");
        // The textarea is kept positioned near the cursor to prevent the
        // fact that it'll be scrolled into view on input from scrolling
        // our fake cursor out of view. On webkit, when wrap=off, paste is
        // very slow. So make the area wide instead.
        if (webkit)
            input.style.width = "1000px";
        else
            input.setAttribute("wrap", "off");
        // If border: 0; -- iOS fails to open keyboard (issue #1287)
        if (ios)
            input.style.border = "1px solid black";
        input.setAttribute("autocorrect", "off");
        input.setAttribute("autocapitalize", "off");
        input.setAttribute("spellcheck", "false");

        // Wraps and hides input textarea
        d.inputDiv = elt("div", [input], null, "overflow: hidden; position: relative; width: 3px; height: 0px;");
        // The fake scrollbar elements.
        d.scrollbarH = elt("div", [elt("div", null, null, "height: 100%; min-height: 1px")], "CodeMirror-hscrollbar");
        d.scrollbarV = elt("div", [elt("div", null, null, "min-width: 1px")], "CodeMirror-vscrollbar");
        // Covers bottom-right square when both scrollbars are present.
        d.scrollbarFiller = elt("div", null, "CodeMirror-scrollbar-filler");
        // Covers bottom of gutter when coverGutterNextToScrollbar is on
        // and h scrollbar is present.
        d.gutterFiller = elt("div", null, "CodeMirror-gutter-filler");
        // Will contain the actual code, positioned to cover the viewport.
        d.lineDiv = elt("div", null, "CodeMirror-code");
        // Elements are added to these to represent selection and cursors.
        d.selectionDiv = elt("div", null, null, "position: relative; z-index: 1");
        d.cursorDiv = elt("div", null, "CodeMirror-cursors");
        // A visibility: hidden element used to find the size of things.
        d.measure = elt("div", null, "CodeMirror-measure");
        // When lines outside of the viewport are measured, they are drawn in this.
        d.lineMeasure = elt("div", null, "CodeMirror-measure");
        // Wraps everything that needs to exist inside the vertically-padded coordinate system
        d.lineSpace = elt("div", [d.measure, d.lineMeasure, d.selectionDiv, d.cursorDiv, d.lineDiv],
                null, "position: relative; outline: none");
        // Moved around its parent to cover visible view.
        d.mover = elt("div", [elt("div", [d.lineSpace], "CodeMirror-lines")], null, "position: relative");
        // Set to the height of the document, allowing scrolling.
        d.sizer = elt("div", [d.mover], "CodeMirror-sizer");
        // Behavior of elts with overflow: auto and padding is
        // inconsistent across browsers. This is used to ensure the
        // scrollable area is big enough.
        d.heightForcer = elt("div", null, null, "position: absolute; height: " + scrollerCutOff + "px; width: 1px;");
        // Will contain the gutters, if any.
        d.gutters = elt("div", null, "CodeMirror-gutters");
        d.lineGutter = null;
        // Actual scrollable element.
        d.scroller = elt("div", [d.sizer, d.heightForcer, d.gutters], "CodeMirror-scroll");
        d.scroller.setAttribute("tabIndex", "-1");
        // The element in which the editor lives.
        d.wrapper = elt("div", [d.inputDiv, d.scrollbarH, d.scrollbarV,
            d.scrollbarFiller, d.gutterFiller, d.scroller], "CodeMirror");

        // Work around IE7 z-index bug (not perfect, hence IE7 not really being supported)
        if (ie_upto7) {
            d.gutters.style.zIndex = -1;
            d.scroller.style.paddingRight = 0;
        }
        // Needed to hide big blue blinking cursor on Mobile Safari
        if (ios)
            input.style.width = "0px";
        if (!webkit)
            d.scroller.draggable = true;
        // Needed to handle Tab key in KHTML
        if (khtml) {
            d.inputDiv.style.height = "1px";
            d.inputDiv.style.position = "absolute";
        }
        // Need to set a minimum width to see the scrollbar on IE7 (but must not set it on IE8).
        if (ie_upto7)
            d.scrollbarH.style.minHeight = d.scrollbarV.style.minWidth = "18px";

        if (place.appendChild)
            place.appendChild(d.wrapper);
        else
            place(d.wrapper);

        // Current rendered range (may be bigger than the view window).
        d.viewFrom = d.viewTo = doc.first;
        // Information about the rendered lines.
        d.view = [];
        // Holds info about a single rendered line when it was rendered
        // for measurement, while not in view.
        d.externalMeasured = null;
        // Empty space (in pixels) above the view
        d.viewOffset = 0;
        d.lastSizeC = 0;
        d.updateLineNumbers = null;

        // Used to only resize the line number gutter when necessary (when
        // the amount of lines crosses a boundary that makes its width change)
        d.lineNumWidth = d.lineNumInnerWidth = d.lineNumChars = null;
        // See readInput and resetInput
        d.prevInput = "";
        // Set to true when a non-horizontal-scrolling line widget is
        // added. As an optimization, line widget aligning is skipped when
        // this is false.
        d.alignWidgets = false;
        // Flag that indicates whether we expect input to appear real soon
        // now (after some event like 'keypress' or 'input') and are
        // polling intensively.
        d.pollingFast = false;
        // Self-resetting timeout for the poller
        d.poll = new Delayed();

        d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;

        // Tracks when resetInput has punted to just putting a short
        // string into the textarea instead of the full selection.
        d.inaccurateSelection = false;

        // Tracks the maximum line length so that the horizontal scrollbar
        // can be kept static when scrolling.
        d.maxLine = null;
        d.maxLineLength = 0;
        d.maxLineChanged = false;

        // Used for measuring wheel scrolling granularity
        d.wheelDX = d.wheelDY = d.wheelStartX = d.wheelStartY = null;

        // True when shift is held down.
        d.shift = false;
    }

    // STATE UPDATES

    // Used to get the editor into a consistent state again when options change.

    function loadMode(cm) {
        cm.doc.mode = CodeMirror.getMode(cm.options, cm.doc.modeOption);
        resetModeState(cm);
    }

    function resetModeState(cm) {
        cm.doc.iter(function (line) {
            if (line.stateAfter)
                line.stateAfter = null;
            if (line.styles)
                line.styles = null;
        });
        cm.doc.frontier = cm.doc.first;
        startWorker(cm, 100);
        cm.state.modeGen++;
        if (cm.curOp)
            regChange(cm);
    }

    function wrappingChanged(cm) {
        if (cm.options.lineWrapping) {
            addClass(cm.display.wrapper, "CodeMirror-wrap");
            cm.display.sizer.style.minWidth = "";
        } else {
            rmClass(cm.display.wrapper, "CodeMirror-wrap");
            findMaxLine(cm);
        }
        estimateLineHeights(cm);
        regChange(cm);
        clearCaches(cm);
        setTimeout(function () {
            updateScrollbars(cm);
        }, 100);
    }

    // Returns a function that estimates the height of a line, to use as
    // first approximation until the line becomes visible (and is thus
    // properly measurable).
    function estimateHeight(cm) {
        var th = textHeight(cm.display), wrapping = cm.options.lineWrapping;
        var perLine = wrapping && Math.max(5, cm.display.scroller.clientWidth / charWidth(cm.display) - 3);
        return function (line) {
            if (lineIsHidden(cm.doc, line))
                return 0;

            var widgetsHeight = 0;
            if (line.widgets)
                for (var i = 0; i < line.widgets.length; i++) {
                    if (line.widgets[i].height)
                        widgetsHeight += line.widgets[i].height;
                }

            if (wrapping)
                return widgetsHeight + (Math.ceil(line.text.length / perLine) || 1) * th;
            else
                return widgetsHeight + th;
        };
    }

    function estimateLineHeights(cm) {
        var doc = cm.doc, est = estimateHeight(cm);
        doc.iter(function (line) {
            var estHeight = est(line);
            if (estHeight != line.height)
                updateLineHeight(line, estHeight);
        });
    }

    function keyMapChanged(cm) {
        var map = keyMap[cm.options.keyMap], style = map.style;
        cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-keymap-\S+/g, "") +
                (style ? " cm-keymap-" + style : "");
    }

    function themeChanged(cm) {
        cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-s-\S+/g, "") +
                cm.options.theme.replace(/(^|\s)\s*/g, " cm-s-");
        clearCaches(cm);
    }

    function guttersChanged(cm) {
        updateGutters(cm);
        regChange(cm);
        setTimeout(function () {
            alignHorizontally(cm);
        }, 20);
    }

    // Rebuild the gutter elements, ensure the margin to the left of the
    // code matches their width.
    function updateGutters(cm) {
        var gutters = cm.display.gutters, specs = cm.options.gutters;
        removeChildren(gutters);
        for (var i = 0; i < specs.length; ++i) {
            var gutterClass = specs[i];
            var gElt = gutters.appendChild(elt("div", null, "CodeMirror-gutter " + gutterClass));
            if (gutterClass == "CodeMirror-linenumbers") {
                cm.display.lineGutter = gElt;
                gElt.style.width = (cm.display.lineNumWidth || 1) + "px";
            }
        }
        gutters.style.display = i ? "" : "none";
        updateGutterSpace(cm);
    }

    function updateGutterSpace(cm) {
        var width = cm.display.gutters.offsetWidth;
        cm.display.sizer.style.marginLeft = width + "px";
        cm.display.scrollbarH.style.left = cm.options.fixedGutter ? width + "px" : 0;
    }

    // Compute the character length of a line, taking into account
    // collapsed ranges (see markText) that might hide parts, and join
    // other lines onto it.
    function lineLength(line) {
        if (line.height == 0)
            return 0;
        var len = line.text.length, merged, cur = line;
        while (merged = collapsedSpanAtStart(cur)) {
            var found = merged.find(0, true);
            cur = found.from.line;
            len += found.from.ch - found.to.ch;
        }
        cur = line;
        while (merged = collapsedSpanAtEnd(cur)) {
            var found = merged.find(0, true);
            len -= cur.text.length - found.from.ch;
            cur = found.to.line;
            len += cur.text.length - found.to.ch;
        }
        return len;
    }

    // Find the longest line in the document.
    function findMaxLine(cm) {
        var d = cm.display, doc = cm.doc;
        d.maxLine = getLine(doc, doc.first);
        d.maxLineLength = lineLength(d.maxLine);
        d.maxLineChanged = true;
        doc.iter(function (line) {
            var len = lineLength(line);
            if (len > d.maxLineLength) {
                d.maxLineLength = len;
                d.maxLine = line;
            }
        });
    }

    // Make sure the gutters options contains the element
    // "CodeMirror-linenumbers" when the lineNumbers option is true.
    function setGuttersForLineNumbers(options) {
        var found = indexOf(options.gutters, "CodeMirror-linenumbers");
        if (found == -1 && options.lineNumbers) {
            options.gutters = options.gutters.concat(["CodeMirror-linenumbers"]);
        } else if (found > -1 && !options.lineNumbers) {
            options.gutters = options.gutters.slice(0);
            options.gutters.splice(found, 1);
        }
    }

    // SCROLLBARS

    // Prepare DOM reads needed to update the scrollbars. Done in one
    // shot to minimize update/measure roundtrips.
    function measureForScrollbars(cm) {
        var scroll = cm.display.scroller;
        return {
            clientHeight: scroll.clientHeight,
            barHeight: cm.display.scrollbarV.clientHeight,
            scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth,
            barWidth: cm.display.scrollbarH.clientWidth,
            docHeight: Math.round(cm.doc.height + paddingVert(cm.display))
        };
    }

    // Re-synchronize the fake scrollbars with the actual size of the
    // content.
    function updateScrollbars(cm, measure) {
        if (!measure)
            measure = measureForScrollbars(cm);
        var d = cm.display;
        var scrollHeight = measure.docHeight + scrollerCutOff;
        var needsH = measure.scrollWidth > measure.clientWidth;
        var needsV = scrollHeight > measure.clientHeight;
        if (needsV) {
            d.scrollbarV.style.display = "block";
            d.scrollbarV.style.bottom = needsH ? scrollbarWidth(d.measure) + "px" : "0";
            // A bug in IE8 can cause this value to be negative, so guard it.
            d.scrollbarV.firstChild.style.height =
                    Math.max(0, scrollHeight - measure.clientHeight + (measure.barHeight || d.scrollbarV.clientHeight)) + "px";
        } else {
            d.scrollbarV.style.display = "";
            d.scrollbarV.firstChild.style.height = "0";
        }
        if (needsH) {
            d.scrollbarH.style.display = "block";
            d.scrollbarH.style.right = needsV ? scrollbarWidth(d.measure) + "px" : "0";
            d.scrollbarH.firstChild.style.width =
                    (measure.scrollWidth - measure.clientWidth + (measure.barWidth || d.scrollbarH.clientWidth)) + "px";
        } else {
            d.scrollbarH.style.display = "";
            d.scrollbarH.firstChild.style.width = "0";
        }
        if (needsH && needsV) {
            d.scrollbarFiller.style.display = "block";
            d.scrollbarFiller.style.height = d.scrollbarFiller.style.width = scrollbarWidth(d.measure) + "px";
        } else
            d.scrollbarFiller.style.display = "";
        if (needsH && cm.options.coverGutterNextToScrollbar && cm.options.fixedGutter) {
            d.gutterFiller.style.display = "block";
            d.gutterFiller.style.height = scrollbarWidth(d.measure) + "px";
            d.gutterFiller.style.width = d.gutters.offsetWidth + "px";
        } else
            d.gutterFiller.style.display = "";

        if (!cm.state.checkedOverlayScrollbar && measure.clientHeight > 0) {
            if (scrollbarWidth(d.measure) === 0) {
                var w = mac && !mac_geMountainLion ? "12px" : "18px";
                d.scrollbarV.style.minWidth = d.scrollbarH.style.minHeight = w;
                var barMouseDown = function (e) {
                    if (e_target(e) != d.scrollbarV && e_target(e) != d.scrollbarH)
                        operation(cm, onMouseDown)(e);
                };
                on(d.scrollbarV, "mousedown", barMouseDown);
                on(d.scrollbarH, "mousedown", barMouseDown);
            }
            cm.state.checkedOverlayScrollbar = true;
        }
    }

    // Compute the lines that are visible in a given viewport (defaults
    // the the current scroll position). viewPort may contain top,
    // height, and ensure (see op.scrollToPos) properties.
    function visibleLines(display, doc, viewPort) {
        var top = viewPort && viewPort.top != null ? viewPort.top : display.scroller.scrollTop;
        top = Math.floor(top - paddingTop(display));
        var bottom = viewPort && viewPort.bottom != null ? viewPort.bottom : top + display.wrapper.clientHeight;

        var from = lineAtHeight(doc, top), to = lineAtHeight(doc, bottom);
        // Ensure is a {from: {line, ch}, to: {line, ch}} object, and
        // forces those lines into the viewport (if possible).
        if (viewPort && viewPort.ensure) {
            var ensureFrom = viewPort.ensure.from.line, ensureTo = viewPort.ensure.to.line;
            if (ensureFrom < from)
                return {from: ensureFrom,
                    to: lineAtHeight(doc, heightAtLine(getLine(doc, ensureFrom)) + display.wrapper.clientHeight)};
            if (Math.min(ensureTo, doc.lastLine()) >= to)
                return {from: lineAtHeight(doc, heightAtLine(getLine(doc, ensureTo)) - display.wrapper.clientHeight),
                    to: ensureTo};
        }
        return {from: from, to: to};
    }

    // LINE NUMBERS

    // Re-align line numbers and gutter marks to compensate for
    // horizontal scrolling.
    function alignHorizontally(cm) {
        var display = cm.display, view = display.view;
        if (!display.alignWidgets && (!display.gutters.firstChild || !cm.options.fixedGutter))
            return;
        var comp = compensateForHScroll(display) - display.scroller.scrollLeft + cm.doc.scrollLeft;
        var gutterW = display.gutters.offsetWidth, left = comp + "px";
        for (var i = 0; i < view.length; i++)
            if (!view[i].hidden) {
                if (cm.options.fixedGutter && view[i].gutter)
                    view[i].gutter.style.left = left;
                var align = view[i].alignable;
                if (align)
                    for (var j = 0; j < align.length; j++)
                        align[j].style.left = left;
            }
        if (cm.options.fixedGutter)
            display.gutters.style.left = (comp + gutterW) + "px";
    }

    // Used to ensure that the line number gutter is still the right
    // size for the current document size. Returns true when an update
    // is needed.
    function maybeUpdateLineNumberWidth(cm) {
        if (!cm.options.lineNumbers)
            return false;
        var doc = cm.doc, last = lineNumberFor(cm.options, doc.first + doc.size - 1), display = cm.display;
        if (last.length != display.lineNumChars) {
            var test = display.measure.appendChild(elt("div", [elt("div", last)],
                    "CodeMirror-linenumber CodeMirror-gutter-elt"));
            var innerW = test.firstChild.offsetWidth, padding = test.offsetWidth - innerW;
            display.lineGutter.style.width = "";
            display.lineNumInnerWidth = Math.max(innerW, display.lineGutter.offsetWidth - padding);
            display.lineNumWidth = display.lineNumInnerWidth + padding;
            display.lineNumChars = display.lineNumInnerWidth ? last.length : -1;
            display.lineGutter.style.width = display.lineNumWidth + "px";
            updateGutterSpace(cm);
            return true;
        }
        return false;
    }

    function lineNumberFor(options, i) {
        return String(options.lineNumberFormatter(i + options.firstLineNumber));
    }

    // Computes display.scroller.scrollLeft + display.gutters.offsetWidth,
    // but using getBoundingClientRect to get a sub-pixel-accurate
    // result.
    function compensateForHScroll(display) {
        return display.scroller.getBoundingClientRect().left - display.sizer.getBoundingClientRect().left;
    }

    // DISPLAY DRAWING

    // Updates the display, selection, and scrollbars, using the
    // information in display.view to find out which nodes are no longer
    // up-to-date. Tries to bail out early when no changes are needed,
    // unless forced is true.
    // Returns true if an actual update happened, false otherwise.
    function updateDisplay(cm, viewPort, forced) {
        var oldFrom = cm.display.viewFrom, oldTo = cm.display.viewTo, updated;
        var visible = visibleLines(cm.display, cm.doc, viewPort);
        for (var first = true; ; first = false) {
            var oldWidth = cm.display.scroller.clientWidth;
            if (!updateDisplayInner(cm, visible, forced))
                break;
            updated = true;

            // If the max line changed since it was last measured, measure it,
            // and ensure the document's width matches it.
            if (cm.display.maxLineChanged && !cm.options.lineWrapping)
                adjustContentWidth(cm);

            var barMeasure = measureForScrollbars(cm);
            updateSelection(cm);
            setDocumentHeight(cm, barMeasure);
            updateScrollbars(cm, barMeasure);
            if (webkit && cm.options.lineWrapping)
                checkForWebkitWidthBug(cm, barMeasure); // (Issue #2420)
            if (first && cm.options.lineWrapping && oldWidth != cm.display.scroller.clientWidth) {
                forced = true;
                continue;
            }
            forced = false;

            // Clip forced viewport to actual scrollable area.
            if (viewPort && viewPort.top != null)
                viewPort = {top: Math.min(barMeasure.docHeight - scrollerCutOff - barMeasure.clientHeight, viewPort.top)};
            // Updated line heights might result in the drawn area not
            // actually covering the viewport. Keep looping until it does.
            visible = visibleLines(cm.display, cm.doc, viewPort);
            if (visible.from >= cm.display.viewFrom && visible.to <= cm.display.viewTo)
                break;
        }

        cm.display.updateLineNumbers = null;
        if (updated) {
            signalLater(cm, "update", cm);
            if (cm.display.viewFrom != oldFrom || cm.display.viewTo != oldTo)
                signalLater(cm, "viewportChange", cm, cm.display.viewFrom, cm.display.viewTo);
        }
        return updated;
    }

    // Does the actual updating of the line display. Bails out
    // (returning false) when there is nothing to be done and forced is
    // false.
    function updateDisplayInner(cm, visible, forced) {
        var display = cm.display, doc = cm.doc;
        if (!display.wrapper.offsetWidth) {
            resetView(cm);
            return;
        }

        // Bail out if the visible area is already rendered and nothing changed.
        if (!forced && visible.from >= display.viewFrom && visible.to <= display.viewTo &&
                countDirtyView(cm) == 0)
            return;

        if (maybeUpdateLineNumberWidth(cm))
            resetView(cm);
        var dims = getDimensions(cm);

        // Compute a suitable new viewport (from & to)
        var end = doc.first + doc.size;
        var from = Math.max(visible.from - cm.options.viewportMargin, doc.first);
        var to = Math.min(end, visible.to + cm.options.viewportMargin);
        if (display.viewFrom < from && from - display.viewFrom < 20)
            from = Math.max(doc.first, display.viewFrom);
        if (display.viewTo > to && display.viewTo - to < 20)
            to = Math.min(end, display.viewTo);
        if (sawCollapsedSpans) {
            from = visualLineNo(cm.doc, from);
            to = visualLineEndNo(cm.doc, to);
        }

        var different = from != display.viewFrom || to != display.viewTo ||
                display.lastSizeC != display.wrapper.clientHeight;
        adjustView(cm, from, to);

        display.viewOffset = heightAtLine(getLine(cm.doc, display.viewFrom));
        // Position the mover div to align with the current scroll position
        cm.display.mover.style.top = display.viewOffset + "px";

        var toUpdate = countDirtyView(cm);
        if (!different && toUpdate == 0 && !forced)
            return;

        // For big changes, we hide the enclosing element during the
        // update, since that speeds up the operations on most browsers.
        var focused = activeElt();
        if (toUpdate > 4)
            display.lineDiv.style.display = "none";
        patchDisplay(cm, display.updateLineNumbers, dims);
        if (toUpdate > 4)
            display.lineDiv.style.display = "";
        // There might have been a widget with a focused element that got
        // hidden or updated, if so re-focus it.
        if (focused && activeElt() != focused && focused.offsetHeight)
            focused.focus();

        // Prevent selection and cursors from interfering with the scroll
        // width.
        removeChildren(display.cursorDiv);
        removeChildren(display.selectionDiv);

        if (different) {
            display.lastSizeC = display.wrapper.clientHeight;
            startWorker(cm, 400);
        }

        updateHeightsInViewport(cm);

        return true;
    }

    function adjustContentWidth(cm) {
        var display = cm.display;
        var width = measureChar(cm, display.maxLine, display.maxLine.text.length).left;
        display.maxLineChanged = false;
        var minWidth = Math.max(0, width + 3);
        var maxScrollLeft = Math.max(0, display.sizer.offsetLeft + minWidth + scrollerCutOff - display.scroller.clientWidth);
        display.sizer.style.minWidth = minWidth + "px";
        if (maxScrollLeft < cm.doc.scrollLeft)
            setScrollLeft(cm, Math.min(display.scroller.scrollLeft, maxScrollLeft), true);
    }

    function setDocumentHeight(cm, measure) {
        cm.display.sizer.style.minHeight = cm.display.heightForcer.style.top = measure.docHeight + "px";
        cm.display.gutters.style.height = Math.max(measure.docHeight, measure.clientHeight - scrollerCutOff) + "px";
    }


    function checkForWebkitWidthBug(cm, measure) {
        // Work around Webkit bug where it sometimes reserves space for a
        // non-existing phantom scrollbar in the scroller (Issue #2420)
        if (cm.display.sizer.offsetWidth + cm.display.gutters.offsetWidth < cm.display.scroller.clientWidth - 1) {
            cm.display.sizer.style.minHeight = cm.display.heightForcer.style.top = "0px";
            cm.display.gutters.style.height = measure.docHeight + "px";
        }
    }

    // Read the actual heights of the rendered lines, and update their
    // stored heights to match.
    function updateHeightsInViewport(cm) {
        var display = cm.display;
        var prevBottom = display.lineDiv.offsetTop;
        for (var i = 0; i < display.view.length; i++) {
            var cur = display.view[i], height;
            if (cur.hidden)
                continue;
            if (ie_upto7) {
                var bot = cur.node.offsetTop + cur.node.offsetHeight;
                height = bot - prevBottom;
                prevBottom = bot;
            } else {
                var box = cur.node.getBoundingClientRect();
                height = box.bottom - box.top;
            }
            var diff = cur.line.height - height;
            if (height < 2)
                height = textHeight(display);
            if (diff > .001 || diff < -.001) {
                updateLineHeight(cur.line, height);
                updateWidgetHeight(cur.line);
                if (cur.rest)
                    for (var j = 0; j < cur.rest.length; j++)
                        updateWidgetHeight(cur.rest[j]);
            }
        }
    }

    // Read and store the height of line widgets associated with the
    // given line.
    function updateWidgetHeight(line) {
        if (line.widgets)
            for (var i = 0; i < line.widgets.length; ++i)
                line.widgets[i].height = line.widgets[i].node.offsetHeight;
    }

    // Do a bulk-read of the DOM positions and sizes needed to draw the
    // view, so that we don't interleave reading and writing to the DOM.
    function getDimensions(cm) {
        var d = cm.display, left = {}, width = {};
        for (var n = d.gutters.firstChild, i = 0; n; n = n.nextSibling, ++i) {
            left[cm.options.gutters[i]] = n.offsetLeft;
            width[cm.options.gutters[i]] = n.offsetWidth;
        }
        return {fixedPos: compensateForHScroll(d),
            gutterTotalWidth: d.gutters.offsetWidth,
            gutterLeft: left,
            gutterWidth: width,
            wrapperWidth: d.wrapper.clientWidth};
    }

    // Sync the actual display DOM structure with display.view, removing
    // nodes for lines that are no longer in view, and creating the ones
    // that are not there yet, and updating the ones that are out of
    // date.
    function patchDisplay(cm, updateNumbersFrom, dims) {
        var display = cm.display, lineNumbers = cm.options.lineNumbers;
        var container = display.lineDiv, cur = container.firstChild;

        function rm(node) {
            var next = node.nextSibling;
            // Works around a throw-scroll bug in OS X Webkit
            if (webkit && mac && cm.display.currentWheelTarget == node)
                node.style.display = "none";
            else
                node.parentNode.removeChild(node);
            return next;
        }

        var view = display.view, lineN = display.viewFrom;
        // Loop over the elements in the view, syncing cur (the DOM nodes
        // in display.lineDiv) with the view as we go.
        for (var i = 0; i < view.length; i++) {
            var lineView = view[i];
            if (lineView.hidden) {
            } else if (!lineView.node) { // Not drawn yet
                var node = buildLineElement(cm, lineView, lineN, dims);
                container.insertBefore(node, cur);
            } else { // Already drawn
                while (cur != lineView.node)
                    cur = rm(cur);
                var updateNumber = lineNumbers && updateNumbersFrom != null &&
                        updateNumbersFrom <= lineN && lineView.lineNumber;
                if (lineView.changes) {
                    if (indexOf(lineView.changes, "gutter") > -1)
                        updateNumber = false;
                    updateLineForChanges(cm, lineView, lineN, dims);
                }
                if (updateNumber) {
                    removeChildren(lineView.lineNumber);
                    lineView.lineNumber.appendChild(document.createTextNode(lineNumberFor(cm.options, lineN)));
                }
                cur = lineView.node.nextSibling;
            }
            lineN += lineView.size;
        }
        while (cur)
            cur = rm(cur);
    }

    // When an aspect of a line changes, a string is added to
    // lineView.changes. This updates the relevant part of the line's
    // DOM structure.
    function updateLineForChanges(cm, lineView, lineN, dims) {
        for (var j = 0; j < lineView.changes.length; j++) {
            var type = lineView.changes[j];
            if (type == "text")
                updateLineText(cm, lineView);
            else if (type == "gutter")
                updateLineGutter(cm, lineView, lineN, dims);
            else if (type == "class")
                updateLineClasses(lineView);
            else if (type == "widget")
                updateLineWidgets(lineView, dims);
        }
        lineView.changes = null;
    }

    // Lines with gutter elements, widgets or a background class need to
    // be wrapped, and have the extra elements added to the wrapper div
    function ensureLineWrapped(lineView) {
        if (lineView.node == lineView.text) {
            lineView.node = elt("div", null, null, "position: relative");
            if (lineView.text.parentNode)
                lineView.text.parentNode.replaceChild(lineView.node, lineView.text);
            lineView.node.appendChild(lineView.text);
            if (ie_upto7)
                lineView.node.style.zIndex = 2;
        }
        return lineView.node;
    }

    function updateLineBackground(lineView) {
        var cls = lineView.bgClass ? lineView.bgClass + " " + (lineView.line.bgClass || "") : lineView.line.bgClass;
        if (cls)
            cls += " CodeMirror-linebackground";
        if (lineView.background) {
            if (cls)
                lineView.background.className = cls;
            else {
                lineView.background.parentNode.removeChild(lineView.background);
                lineView.background = null;
            }
        } else if (cls) {
            var wrap = ensureLineWrapped(lineView);
            lineView.background = wrap.insertBefore(elt("div", null, cls), wrap.firstChild);
        }
    }

    // Wrapper around buildLineContent which will reuse the structure
    // in display.externalMeasured when possible.
    function getLineContent(cm, lineView) {
        var ext = cm.display.externalMeasured;
        if (ext && ext.line == lineView.line) {
            cm.display.externalMeasured = null;
            lineView.measure = ext.measure;
            return ext.built;
        }
        return buildLineContent(cm, lineView);
    }

    // Redraw the line's text. Interacts with the background and text
    // classes because the mode may output tokens that influence these
    // classes.
    function updateLineText(cm, lineView) {
        var cls = lineView.text.className;
        var built = getLineContent(cm, lineView);
        if (lineView.text == lineView.node)
            lineView.node = built.pre;
        lineView.text.parentNode.replaceChild(built.pre, lineView.text);
        lineView.text = built.pre;
        if (built.bgClass != lineView.bgClass || built.textClass != lineView.textClass) {
            lineView.bgClass = built.bgClass;
            lineView.textClass = built.textClass;
            updateLineClasses(lineView);
        } else if (cls) {
            lineView.text.className = cls;
        }
    }

    function updateLineClasses(lineView) {
        updateLineBackground(lineView);
        if (lineView.line.wrapClass)
            ensureLineWrapped(lineView).className = lineView.line.wrapClass;
        else if (lineView.node != lineView.text)
            lineView.node.className = "";
        var textClass = lineView.textClass ? lineView.textClass + " " + (lineView.line.textClass || "") : lineView.line.textClass;
        lineView.text.className = textClass || "";
    }

    function updateLineGutter(cm, lineView, lineN, dims) {
        if (lineView.gutter) {
            lineView.node.removeChild(lineView.gutter);
            lineView.gutter = null;
        }
        var markers = lineView.line.gutterMarkers;
        if (cm.options.lineNumbers || markers) {
            var wrap = ensureLineWrapped(lineView);
            var gutterWrap = lineView.gutter =
                    wrap.insertBefore(elt("div", null, "CodeMirror-gutter-wrapper", "position: absolute; left: " +
                            (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) + "px"),
                            lineView.text);
            if (cm.options.lineNumbers && (!markers || !markers["CodeMirror-linenumbers"]))
                lineView.lineNumber = gutterWrap.appendChild(
                        elt("div", lineNumberFor(cm.options, lineN),
                                "CodeMirror-linenumber CodeMirror-gutter-elt",
                                "left: " + dims.gutterLeft["CodeMirror-linenumbers"] + "px; width: "
                                + cm.display.lineNumInnerWidth + "px"));
            if (markers)
                for (var k = 0; k < cm.options.gutters.length; ++k) {
                    var id = cm.options.gutters[k], found = markers.hasOwnProperty(id) && markers[id];
                    if (found)
                        gutterWrap.appendChild(elt("div", [found], "CodeMirror-gutter-elt", "left: " +
                                dims.gutterLeft[id] + "px; width: " + dims.gutterWidth[id] + "px"));
                }
        }
    }

    function updateLineWidgets(lineView, dims) {
        if (lineView.alignable)
            lineView.alignable = null;
        for (var node = lineView.node.firstChild, next; node; node = next) {
            var next = node.nextSibling;
            if (node.className == "CodeMirror-linewidget")
                lineView.node.removeChild(node);
        }
        insertLineWidgets(lineView, dims);
    }

    // Build a line's DOM representation from scratch
    function buildLineElement(cm, lineView, lineN, dims) {
        var built = getLineContent(cm, lineView);
        lineView.text = lineView.node = built.pre;
        if (built.bgClass)
            lineView.bgClass = built.bgClass;
        if (built.textClass)
            lineView.textClass = built.textClass;

        updateLineClasses(lineView);
        updateLineGutter(cm, lineView, lineN, dims);
        insertLineWidgets(lineView, dims);
        return lineView.node;
    }

    // A lineView may contain multiple logical lines (when merged by
    // collapsed spans). The widgets for all of them need to be drawn.
    function insertLineWidgets(lineView, dims) {
        insertLineWidgetsFor(lineView.line, lineView, dims, true);
        if (lineView.rest)
            for (var i = 0; i < lineView.rest.length; i++)
                insertLineWidgetsFor(lineView.rest[i], lineView, dims, false);
    }

    function insertLineWidgetsFor(line, lineView, dims, allowAbove) {
        if (!line.widgets)
            return;
        var wrap = ensureLineWrapped(lineView);
        for (var i = 0, ws = line.widgets; i < ws.length; ++i) {
            var widget = ws[i], node = elt("div", [widget.node], "CodeMirror-linewidget");
            if (!widget.handleMouseEvents)
                node.ignoreEvents = true;
            positionLineWidget(widget, node, lineView, dims);
            if (allowAbove && widget.above)
                wrap.insertBefore(node, lineView.gutter || lineView.text);
            else
                wrap.appendChild(node);
            signalLater(widget, "redraw");
        }
    }

    function positionLineWidget(widget, node, lineView, dims) {
        if (widget.noHScroll) {
            (lineView.alignable || (lineView.alignable = [])).push(node);
            var width = dims.wrapperWidth;
            node.style.left = dims.fixedPos + "px";
            if (!widget.coverGutter) {
                width -= dims.gutterTotalWidth;
                node.style.paddingLeft = dims.gutterTotalWidth + "px";
            }
            node.style.width = width + "px";
        }
        if (widget.coverGutter) {
            node.style.zIndex = 5;
            node.style.position = "relative";
            if (!widget.noHScroll)
                node.style.marginLeft = -dims.gutterTotalWidth + "px";
        }
    }

    // POSITION OBJECT

    // A Pos instance represents a position within the text.
    var Pos = CodeMirror.Pos = function (line, ch) {
        if (!(this instanceof Pos))
            return new Pos(line, ch);
        this.line = line;
        this.ch = ch;
    };

    // Compare two positions, return 0 if they are the same, a negative
    // number when a is less, and a positive number otherwise.
    var cmp = CodeMirror.cmpPos = function (a, b) {
        return a.line - b.line || a.ch - b.ch;
    };

    function copyPos(x) {
        return Pos(x.line, x.ch);
    }
    function maxPos(a, b) {
        return cmp(a, b) < 0 ? b : a;
    }
    function minPos(a, b) {
        return cmp(a, b) < 0 ? a : b;
    }

    // SELECTION / CURSOR

    // Selection objects are immutable. A new one is created every time
    // the selection changes. A selection is one or more non-overlapping
    // (and non-touching) ranges, sorted, and an integer that indicates
    // which one is the primary selection (the one that's scrolled into
    // view, that getCursor returns, etc).
    function Selection(ranges, primIndex) {
        this.ranges = ranges;
        this.primIndex = primIndex;
    }

    Selection.prototype = {
        primary: function () {
            return this.ranges[this.primIndex];
        },
        equals: function (other) {
            if (other == this)
                return true;
            if (other.primIndex != this.primIndex || other.ranges.length != this.ranges.length)
                return false;
            for (var i = 0; i < this.ranges.length; i++) {
                var here = this.ranges[i], there = other.ranges[i];
                if (cmp(here.anchor, there.anchor) != 0 || cmp(here.head, there.head) != 0)
                    return false;
            }
            return true;
        },
        deepCopy: function () {
            for (var out = [], i = 0; i < this.ranges.length; i++)
                out[i] = new Range(copyPos(this.ranges[i].anchor), copyPos(this.ranges[i].head));
            return new Selection(out, this.primIndex);
        },
        somethingSelected: function () {
            for (var i = 0; i < this.ranges.length; i++)
                if (!this.ranges[i].empty())
                    return true;
            return false;
        },
        contains: function (pos, end) {
            if (!end)
                end = pos;
            for (var i = 0; i < this.ranges.length; i++) {
                var range = this.ranges[i];
                if (cmp(end, range.from()) >= 0 && cmp(pos, range.to()) <= 0)
                    return i;
            }
            return -1;
        }
    };

    function Range(anchor, head) {
        this.anchor = anchor;
        this.head = head;
    }

    Range.prototype = {
        from: function () {
            return minPos(this.anchor, this.head);
        },
        to: function () {
            return maxPos(this.anchor, this.head);
        },
        empty: function () {
            return this.head.line == this.anchor.line && this.head.ch == this.anchor.ch;
        }
    };

    // Take an unsorted, potentially overlapping set of ranges, and
    // build a selection out of it. 'Consumes' ranges array (modifying
    // it).
    function normalizeSelection(ranges, primIndex) {
        var prim = ranges[primIndex];
        ranges.sort(function (a, b) {
            return cmp(a.from(), b.from());
        });
        primIndex = indexOf(ranges, prim);
        for (var i = 1; i < ranges.length; i++) {
            var cur = ranges[i], prev = ranges[i - 1];
            if (cmp(prev.to(), cur.from()) >= 0) {
                var from = minPos(prev.from(), cur.from()), to = maxPos(prev.to(), cur.to());
                var inv = prev.empty() ? cur.from() == cur.head : prev.from() == prev.head;
                if (i <= primIndex)
                    --primIndex;
                ranges.splice(--i, 2, new Range(inv ? to : from, inv ? from : to));
            }
        }
        return new Selection(ranges, primIndex);
    }

    function simpleSelection(anchor, head) {
        return new Selection([new Range(anchor, head || anchor)], 0);
    }

    // Most of the external API clips given positions to make sure they
    // actually exist within the document.
    function clipLine(doc, n) {
        return Math.max(doc.first, Math.min(n, doc.first + doc.size - 1));
    }
    function clipPos(doc, pos) {
        if (pos.line < doc.first)
            return Pos(doc.first, 0);
        var last = doc.first + doc.size - 1;
        if (pos.line > last)
            return Pos(last, getLine(doc, last).text.length);
        return clipToLen(pos, getLine(doc, pos.line).text.length);
    }
    function clipToLen(pos, linelen) {
        var ch = pos.ch;
        if (ch == null || ch > linelen)
            return Pos(pos.line, linelen);
        else if (ch < 0)
            return Pos(pos.line, 0);
        else
            return pos;
    }
    function isLine(doc, l) {
        return l >= doc.first && l < doc.first + doc.size;
    }
    function clipPosArray(doc, array) {
        for (var out = [], i = 0; i < array.length; i++)
            out[i] = clipPos(doc, array[i]);
        return out;
    }

    // SELECTION UPDATES

    // The 'scroll' parameter given to many of these indicated whether
    // the new cursor position should be scrolled into view after
    // modifying the selection.

    // If shift is held or the extend flag is set, extends a range to
    // include a given position (and optionally a second position).
    // Otherwise, simply returns the range between the given positions.
    // Used for cursor motion and such.
    function extendRange(doc, range, head, other) {
        if (doc.cm && doc.cm.display.shift || doc.extend) {
            var anchor = range.anchor;
            if (other) {
                var posBefore = cmp(head, anchor) < 0;
                if (posBefore != (cmp(other, anchor) < 0)) {
                    anchor = head;
                    head = other;
                } else if (posBefore != (cmp(head, other) < 0)) {
                    head = other;
                }
            }
            return new Range(anchor, head);
        } else {
            return new Range(other || head, head);
        }
    }

    // Extend the primary selection range, discard the rest.
    function extendSelection(doc, head, other, options) {
        setSelection(doc, new Selection([extendRange(doc, doc.sel.primary(), head, other)], 0), options);
    }

    // Extend all selections (pos is an array of selections with length
    // equal the number of selections)
    function extendSelections(doc, heads, options) {
        for (var out = [], i = 0; i < doc.sel.ranges.length; i++)
            out[i] = extendRange(doc, doc.sel.ranges[i], heads[i], null);
        var newSel = normalizeSelection(out, doc.sel.primIndex);
        setSelection(doc, newSel, options);
    }

    // Updates a single range in the selection.
    function replaceOneSelection(doc, i, range, options) {
        var ranges = doc.sel.ranges.slice(0);
        ranges[i] = range;
        setSelection(doc, normalizeSelection(ranges, doc.sel.primIndex), options);
    }

    // Reset the selection to a single range.
    function setSimpleSelection(doc, anchor, head, options) {
        setSelection(doc, simpleSelection(anchor, head), options);
    }

    // Give beforeSelectionChange handlers a change to influence a
    // selection update.
    function filterSelectionChange(doc, sel) {
        var obj = {
            ranges: sel.ranges,
            update: function (ranges) {
                this.ranges = [];
                for (var i = 0; i < ranges.length; i++)
                    this.ranges[i] = new Range(clipPos(doc, ranges[i].anchor),
                            clipPos(doc, ranges[i].head));
            }
        };
        signal(doc, "beforeSelectionChange", doc, obj);
        if (doc.cm)
            signal(doc.cm, "beforeSelectionChange", doc.cm, obj);
        if (obj.ranges != sel.ranges)
            return normalizeSelection(obj.ranges, obj.ranges.length - 1);
        else
            return sel;
    }

    function setSelectionReplaceHistory(doc, sel, options) {
        var done = doc.history.done, last = lst(done);
        if (last && last.ranges) {
            done[done.length - 1] = sel;
            setSelectionNoUndo(doc, sel, options);
        } else {
            setSelection(doc, sel, options);
        }
    }

    // Set a new selection.
    function setSelection(doc, sel, options) {
        setSelectionNoUndo(doc, sel, options);
        addSelectionToHistory(doc, doc.sel, doc.cm ? doc.cm.curOp.id : NaN, options);
    }

    function setSelectionNoUndo(doc, sel, options) {
        if (hasHandler(doc, "beforeSelectionChange") || doc.cm && hasHandler(doc.cm, "beforeSelectionChange"))
            sel = filterSelectionChange(doc, sel);

        var bias = cmp(sel.primary().head, doc.sel.primary().head) < 0 ? -1 : 1;
        setSelectionInner(doc, skipAtomicInSelection(doc, sel, bias, true));

        if (!(options && options.scroll === false) && doc.cm)
            ensureCursorVisible(doc.cm);
    }

    function setSelectionInner(doc, sel) {
        if (sel.equals(doc.sel))
            return;

        doc.sel = sel;

        if (doc.cm) {
            doc.cm.curOp.updateInput = doc.cm.curOp.selectionChanged = true;
            signalCursorActivity(doc.cm);
        }
        signalLater(doc, "cursorActivity", doc);
    }

    // Verify that the selection does not partially select any atomic
    // marked ranges.
    function reCheckSelection(doc) {
        setSelectionInner(doc, skipAtomicInSelection(doc, doc.sel, null, false), sel_dontScroll);
    }

    // Return a selection that does not partially select any atomic
    // ranges.
    function skipAtomicInSelection(doc, sel, bias, mayClear) {
        var out;
        for (var i = 0; i < sel.ranges.length; i++) {
            var range = sel.ranges[i];
            var newAnchor = skipAtomic(doc, range.anchor, bias, mayClear);
            var newHead = skipAtomic(doc, range.head, bias, mayClear);
            if (out || newAnchor != range.anchor || newHead != range.head) {
                if (!out)
                    out = sel.ranges.slice(0, i);
                out[i] = new Range(newAnchor, newHead);
            }
        }
        return out ? normalizeSelection(out, sel.primIndex) : sel;
    }

    // Ensure a given position is not inside an atomic range.
    function skipAtomic(doc, pos, bias, mayClear) {
        var flipped = false, curPos = pos;
        var dir = bias || 1;
        doc.cantEdit = false;
        search: for (; ; ) {
            var line = getLine(doc, curPos.line);
            if (line.markedSpans) {
                for (var i = 0; i < line.markedSpans.length; ++i) {
                    var sp = line.markedSpans[i], m = sp.marker;
                    if ((sp.from == null || (m.inclusiveLeft ? sp.from <= curPos.ch : sp.from < curPos.ch)) &&
                            (sp.to == null || (m.inclusiveRight ? sp.to >= curPos.ch : sp.to > curPos.ch))) {
                        if (mayClear) {
                            signal(m, "beforeCursorEnter");
                            if (m.explicitlyCleared) {
                                if (!line.markedSpans)
                                    break;
                                else {
                                    --i;
                                    continue;
                                }
                            }
                        }
                        if (!m.atomic)
                            continue;
                        var newPos = m.find(dir < 0 ? -1 : 1);
                        if (cmp(newPos, curPos) == 0) {
                            newPos.ch += dir;
                            if (newPos.ch < 0) {
                                if (newPos.line > doc.first)
                                    newPos = clipPos(doc, Pos(newPos.line - 1));
                                else
                                    newPos = null;
                            } else if (newPos.ch > line.text.length) {
                                if (newPos.line < doc.first + doc.size - 1)
                                    newPos = Pos(newPos.line + 1, 0);
                                else
                                    newPos = null;
                            }
                            if (!newPos) {
                                if (flipped) {
                                    // Driven in a corner -- no valid cursor position found at all
                                    // -- try again *with* clearing, if we didn't already
                                    if (!mayClear)
                                        return skipAtomic(doc, pos, bias, true);
                                    // Otherwise, turn off editing until further notice, and return the start of the doc
                                    doc.cantEdit = true;
                                    return Pos(doc.first, 0);
                                }
                                flipped = true;
                                newPos = pos;
                                dir = -dir;
                            }
                        }
                        curPos = newPos;
                        continue search;
                    }
                }
            }
            return curPos;
        }
    }

    // SELECTION DRAWING

    // Redraw the selection and/or cursor
    function updateSelection(cm) {
        var display = cm.display, doc = cm.doc;
        var curFragment = document.createDocumentFragment();
        var selFragment = document.createDocumentFragment();

        for (var i = 0; i < doc.sel.ranges.length; i++) {
            var range = doc.sel.ranges[i];
            var collapsed = range.empty();
            if (collapsed || cm.options.showCursorWhenSelecting)
                drawSelectionCursor(cm, range, curFragment);
            if (!collapsed)
                drawSelectionRange(cm, range, selFragment);
        }

        // Move the hidden textarea near the cursor to prevent scrolling artifacts
        if (cm.options.moveInputWithCursor) {
            var headPos = cursorCoords(cm, doc.sel.primary().head, "div");
            var wrapOff = display.wrapper.getBoundingClientRect(), lineOff = display.lineDiv.getBoundingClientRect();
            var top = Math.max(0, Math.min(display.wrapper.clientHeight - 10,
                    headPos.top + lineOff.top - wrapOff.top));
            var left = Math.max(0, Math.min(display.wrapper.clientWidth - 10,
                    headPos.left + lineOff.left - wrapOff.left));
            display.inputDiv.style.top = top + "px";
            display.inputDiv.style.left = left + "px";
        }

        removeChildrenAndAdd(display.cursorDiv, curFragment);
        removeChildrenAndAdd(display.selectionDiv, selFragment);
    }

    // Draws a cursor for the given range
    function drawSelectionCursor(cm, range, output) {
        var pos = cursorCoords(cm, range.head, "div");

        var cursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor"));
        cursor.style.left = pos.left + "px";
        cursor.style.top = pos.top + "px";
        cursor.style.height = Math.max(0, pos.bottom - pos.top) * cm.options.cursorHeight + "px";

        if (pos.other) {
            // Secondary cursor, shown when on a 'jump' in bi-directional text
            var otherCursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor CodeMirror-secondarycursor"));
            otherCursor.style.display = "";
            otherCursor.style.left = pos.other.left + "px";
            otherCursor.style.top = pos.other.top + "px";
            otherCursor.style.height = (pos.other.bottom - pos.other.top) * .85 + "px";
        }
    }

    // Draws the given range as a highlighted selection
    function drawSelectionRange(cm, range, output) {
        var display = cm.display, doc = cm.doc;
        var fragment = document.createDocumentFragment();
        var padding = paddingH(cm.display), leftSide = padding.left, rightSide = display.lineSpace.offsetWidth - padding.right;

        function add(left, top, width, bottom) {
            if (top < 0)
                top = 0;
            top = Math.round(top);
            bottom = Math.round(bottom);
            fragment.appendChild(elt("div", null, "CodeMirror-selected", "position: absolute; left: " + left +
                    "px; top: " + top + "px; width: " + (width == null ? rightSide - left : width) +
                    "px; height: " + (bottom - top) + "px"));
        }

        function drawForLine(line, fromArg, toArg) {
            var lineObj = getLine(doc, line);
            var lineLen = lineObj.text.length;
            var start, end;
            function coords(ch, bias) {
                return charCoords(cm, Pos(line, ch), "div", lineObj, bias);
            }

            iterateBidiSections(getOrder(lineObj), fromArg || 0, toArg == null ? lineLen : toArg, function (from, to, dir) {
                var leftPos = coords(from, "left"), rightPos, left, right;
                if (from == to) {
                    rightPos = leftPos;
                    left = right = leftPos.left;
                } else {
                    rightPos = coords(to - 1, "right");
                    if (dir == "rtl") {
                        var tmp = leftPos;
                        leftPos = rightPos;
                        rightPos = tmp;
                    }
                    left = leftPos.left;
                    right = rightPos.right;
                }
                if (fromArg == null && from == 0)
                    left = leftSide;
                if (rightPos.top - leftPos.top > 3) { // Different lines, draw top part
                    add(left, leftPos.top, null, leftPos.bottom);
                    left = leftSide;
                    if (leftPos.bottom < rightPos.top)
                        add(left, leftPos.bottom, null, rightPos.top);
                }
                if (toArg == null && to == lineLen)
                    right = rightSide;
                if (!start || leftPos.top < start.top || leftPos.top == start.top && leftPos.left < start.left)
                    start = leftPos;
                if (!end || rightPos.bottom > end.bottom || rightPos.bottom == end.bottom && rightPos.right > end.right)
                    end = rightPos;
                if (left < leftSide + 1)
                    left = leftSide;
                add(left, rightPos.top, right - left, rightPos.bottom);
            });
            return {start: start, end: end};
        }

        var sFrom = range.from(), sTo = range.to();
        if (sFrom.line == sTo.line) {
            drawForLine(sFrom.line, sFrom.ch, sTo.ch);
        } else {
            var fromLine = getLine(doc, sFrom.line), toLine = getLine(doc, sTo.line);
            var singleVLine = visualLine(fromLine) == visualLine(toLine);
            var leftEnd = drawForLine(sFrom.line, sFrom.ch, singleVLine ? fromLine.text.length + 1 : null).end;
            var rightStart = drawForLine(sTo.line, singleVLine ? 0 : null, sTo.ch).start;
            if (singleVLine) {
                if (leftEnd.top < rightStart.top - 2) {
                    add(leftEnd.right, leftEnd.top, null, leftEnd.bottom);
                    add(leftSide, rightStart.top, rightStart.left, rightStart.bottom);
                } else {
                    add(leftEnd.right, leftEnd.top, rightStart.left - leftEnd.right, leftEnd.bottom);
                }
            }
            if (leftEnd.bottom < rightStart.top)
                add(leftSide, leftEnd.bottom, null, rightStart.top);
        }

        output.appendChild(fragment);
    }

    // Cursor-blinking
    function restartBlink(cm) {
        if (!cm.state.focused)
            return;
        var display = cm.display;
        clearInterval(display.blinker);
        var on = true;
        display.cursorDiv.style.visibility = "";
        if (cm.options.cursorBlinkRate > 0)
            display.blinker = setInterval(function () {
                display.cursorDiv.style.visibility = (on = !on) ? "" : "hidden";
            }, cm.options.cursorBlinkRate);
    }

    // HIGHLIGHT WORKER

    function startWorker(cm, time) {
        if (cm.doc.mode.startState && cm.doc.frontier < cm.display.viewTo)
            cm.state.highlight.set(time, bind(highlightWorker, cm));
    }

    function highlightWorker(cm) {
        var doc = cm.doc;
        if (doc.frontier < doc.first)
            doc.frontier = doc.first;
        if (doc.frontier >= cm.display.viewTo)
            return;
        var end = +new Date + cm.options.workTime;
        var state = copyState(doc.mode, getStateBefore(cm, doc.frontier));

        runInOp(cm, function () {
            doc.iter(doc.frontier, Math.min(doc.first + doc.size, cm.display.viewTo + 500), function (line) {
                if (doc.frontier >= cm.display.viewFrom) { // Visible
                    var oldStyles = line.styles;
                    var highlighted = highlightLine(cm, line, state, true);
                    line.styles = highlighted.styles;
                    if (highlighted.classes)
                        line.styleClasses = highlighted.classes;
                    else if (line.styleClasses)
                        line.styleClasses = null;
                    var ischange = !oldStyles || oldStyles.length != line.styles.length;
                    for (var i = 0; !ischange && i < oldStyles.length; ++i)
                        ischange = oldStyles[i] != line.styles[i];
                    if (ischange)
                        regLineChange(cm, doc.frontier, "text");
                    line.stateAfter = copyState(doc.mode, state);
                } else {
                    processLine(cm, line.text, state);
                    line.stateAfter = doc.frontier % 5 == 0 ? copyState(doc.mode, state) : null;
                }
                ++doc.frontier;
                if (+new Date > end) {
                    startWorker(cm, cm.options.workDelay);
                    return true;
                }
            });
        });
    }

    // Finds the line to start with when starting a parse. Tries to
    // find a line with a stateAfter, so that it can start with a
    // valid state. If that fails, it returns the line with the
    // smallest indentation, which tends to need the least context to
    // parse correctly.
    function findStartLine(cm, n, precise) {
        var minindent, minline, doc = cm.doc;
        var lim = precise ? -1 : n - (cm.doc.mode.innerMode ? 1000 : 100);
        for (var search = n; search > lim; --search) {
            if (search <= doc.first)
                return doc.first;
            var line = getLine(doc, search - 1);
            if (line.stateAfter && (!precise || search <= doc.frontier))
                return search;
            var indented = countColumn(line.text, null, cm.options.tabSize);
            if (minline == null || minindent > indented) {
                minline = search - 1;
                minindent = indented;
            }
        }
        return minline;
    }

    function getStateBefore(cm, n, precise) {
        var doc = cm.doc, display = cm.display;
        if (!doc.mode.startState)
            return true;
        var pos = findStartLine(cm, n, precise), state = pos > doc.first && getLine(doc, pos - 1).stateAfter;
        if (!state)
            state = startState(doc.mode);
        else
            state = copyState(doc.mode, state);
        doc.iter(pos, n, function (line) {
            processLine(cm, line.text, state);
            var save = pos == n - 1 || pos % 5 == 0 || pos >= display.viewFrom && pos < display.viewTo;
            line.stateAfter = save ? copyState(doc.mode, state) : null;
            ++pos;
        });
        if (precise)
            doc.frontier = pos;
        return state;
    }

    // POSITION MEASUREMENT

    function paddingTop(display) {
        return display.lineSpace.offsetTop;
    }
    function paddingVert(display) {
        return display.mover.offsetHeight - display.lineSpace.offsetHeight;
    }
    function paddingH(display) {
        if (display.cachedPaddingH)
            return display.cachedPaddingH;
        var e = removeChildrenAndAdd(display.measure, elt("pre", "x"));
        var style = window.getComputedStyle ? window.getComputedStyle(e) : e.currentStyle;
        var data = {left: parseInt(style.paddingLeft), right: parseInt(style.paddingRight)};
        if (!isNaN(data.left) && !isNaN(data.right))
            display.cachedPaddingH = data;
        return data;
    }

    // Ensure the lineView.wrapping.heights array is populated. This is
    // an array of bottom offsets for the lines that make up a drawn
    // line. When lineWrapping is on, there might be more than one
    // height.
    function ensureLineHeights(cm, lineView, rect) {
        var wrapping = cm.options.lineWrapping;
        var curWidth = wrapping && cm.display.scroller.clientWidth;
        if (!lineView.measure.heights || wrapping && lineView.measure.width != curWidth) {
            var heights = lineView.measure.heights = [];
            if (wrapping) {
                lineView.measure.width = curWidth;
                var rects = lineView.text.firstChild.getClientRects();
                for (var i = 0; i < rects.length - 1; i++) {
                    var cur = rects[i], next = rects[i + 1];
                    if (Math.abs(cur.bottom - next.bottom) > 2)
                        heights.push((cur.bottom + next.top) / 2 - rect.top);
                }
            }
            heights.push(rect.bottom - rect.top);
        }
    }

    // Find a line map (mapping character offsets to text nodes) and a
    // measurement cache for the given line number. (A line view might
    // contain multiple lines when collapsed ranges are present.)
    function mapFromLineView(lineView, line, lineN) {
        if (lineView.line == line)
            return {map: lineView.measure.map, cache: lineView.measure.cache};
        for (var i = 0; i < lineView.rest.length; i++)
            if (lineView.rest[i] == line)
                return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i]};
        for (var i = 0; i < lineView.rest.length; i++)
            if (lineNo(lineView.rest[i]) > lineN)
                return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i], before: true};
    }

    // Render a line into the hidden node display.externalMeasured. Used
    // when measurement is needed for a line that's not in the viewport.
    function updateExternalMeasurement(cm, line) {
        line = visualLine(line);
        var lineN = lineNo(line);
        var view = cm.display.externalMeasured = new LineView(cm.doc, line, lineN);
        view.lineN = lineN;
        var built = view.built = buildLineContent(cm, view);
        view.text = built.pre;
        removeChildrenAndAdd(cm.display.lineMeasure, built.pre);
        return view;
    }

    // Get a {top, bottom, left, right} box (in line-local coordinates)
    // for a given character.
    function measureChar(cm, line, ch, bias) {
        return measureCharPrepared(cm, prepareMeasureForLine(cm, line), ch, bias);
    }

    // Find a line view that corresponds to the given line number.
    function findViewForLine(cm, lineN) {
        if (lineN >= cm.display.viewFrom && lineN < cm.display.viewTo)
            return cm.display.view[findViewIndex(cm, lineN)];
        var ext = cm.display.externalMeasured;
        if (ext && lineN >= ext.lineN && lineN < ext.lineN + ext.size)
            return ext;
    }

    // Measurement can be split in two steps, the set-up work that
    // applies to the whole line, and the measurement of the actual
    // character. Functions like coordsChar, that need to do a lot of
    // measurements in a row, can thus ensure that the set-up work is
    // only done once.
    function prepareMeasureForLine(cm, line) {
        var lineN = lineNo(line);
        var view = findViewForLine(cm, lineN);
        if (view && !view.text)
            view = null;
        else if (view && view.changes)
            updateLineForChanges(cm, view, lineN, getDimensions(cm));
        if (!view)
            view = updateExternalMeasurement(cm, line);

        var info = mapFromLineView(view, line, lineN);
        return {
            line: line, view: view, rect: null,
            map: info.map, cache: info.cache, before: info.before,
            hasHeights: false
        };
    }

    // Given a prepared measurement object, measures the position of an
    // actual character (or fetches it from the cache).
    function measureCharPrepared(cm, prepared, ch, bias) {
        if (prepared.before)
            ch = -1;
        var key = ch + (bias || ""), found;
        if (prepared.cache.hasOwnProperty(key)) {
            found = prepared.cache[key];
        } else {
            if (!prepared.rect)
                prepared.rect = prepared.view.text.getBoundingClientRect();
            if (!prepared.hasHeights) {
                ensureLineHeights(cm, prepared.view, prepared.rect);
                prepared.hasHeights = true;
            }
            found = measureCharInner(cm, prepared, ch, bias);
            if (!found.bogus)
                prepared.cache[key] = found;
        }
        return {left: found.left, right: found.right, top: found.top, bottom: found.bottom};
    }

    var nullRect = {left: 0, right: 0, top: 0, bottom: 0};

    function measureCharInner(cm, prepared, ch, bias) {
        var map = prepared.map;

        var node, start, end, collapse;
        // First, search the line map for the text node corresponding to,
        // or closest to, the target character.
        for (var i = 0; i < map.length; i += 3) {
            var mStart = map[i], mEnd = map[i + 1];
            if (ch < mStart) {
                start = 0;
                end = 1;
                collapse = "left";
            } else if (ch < mEnd) {
                start = ch - mStart;
                end = start + 1;
            } else if (i == map.length - 3 || ch == mEnd && map[i + 3] > ch) {
                end = mEnd - mStart;
                start = end - 1;
                if (ch >= mEnd)
                    collapse = "right";
            }
            if (start != null) {
                node = map[i + 2];
                if (mStart == mEnd && bias == (node.insertLeft ? "left" : "right"))
                    collapse = bias;
                if (bias == "left" && start == 0)
                    while (i && map[i - 2] == map[i - 3] && map[i - 1].insertLeft) {
                        node = map[(i -= 3) + 2];
                        collapse = "left";
                    }
                if (bias == "right" && start == mEnd - mStart)
                    while (i < map.length - 3 && map[i + 3] == map[i + 4] && !map[i + 5].insertLeft) {
                        node = map[(i += 3) + 2];
                        collapse = "right";
                    }
                break;
            }
        }

        var rect;
        if (node.nodeType == 3) { // If it is a text node, use a range to retrieve the coordinates.
            while (start && isExtendingChar(prepared.line.text.charAt(mStart + start)))
                --start;
            while (mStart + end < mEnd && isExtendingChar(prepared.line.text.charAt(mStart + end)))
                ++end;
            if (ie_upto8 && start == 0 && end == mEnd - mStart) {
                rect = node.parentNode.getBoundingClientRect();
            } else if (ie && cm.options.lineWrapping) {
                var rects = range(node, start, end).getClientRects();
                if (rects.length)
                    rect = rects[bias == "right" ? rects.length - 1 : 0];
                else
                    rect = nullRect;
            } else {
                rect = range(node, start, end).getBoundingClientRect();
            }
        } else { // If it is a widget, simply get the box for the whole widget.
            if (start > 0)
                collapse = bias = "right";
            var rects;
            if (cm.options.lineWrapping && (rects = node.getClientRects()).length > 1)
                rect = rects[bias == "right" ? rects.length - 1 : 0];
            else
                rect = node.getBoundingClientRect();
        }
        if (ie_upto8 && !start && (!rect || !rect.left && !rect.right)) {
            var rSpan = node.parentNode.getClientRects()[0];
            if (rSpan)
                rect = {left: rSpan.left, right: rSpan.left + charWidth(cm.display), top: rSpan.top, bottom: rSpan.bottom};
            else
                rect = nullRect;
        }

        var top, bot = (rect.bottom + rect.top) / 2 - prepared.rect.top;
        var heights = prepared.view.measure.heights;
        for (var i = 0; i < heights.length - 1; i++)
            if (bot < heights[i])
                break;
        top = i ? heights[i - 1] : 0;
        bot = heights[i];
        var result = {left: (collapse == "right" ? rect.right : rect.left) - prepared.rect.left,
            right: (collapse == "left" ? rect.left : rect.right) - prepared.rect.left,
            top: top, bottom: bot};
        if (!rect.left && !rect.right)
            result.bogus = true;
        return result;
    }

    function clearLineMeasurementCacheFor(lineView) {
        if (lineView.measure) {
            lineView.measure.cache = {};
            lineView.measure.heights = null;
            if (lineView.rest)
                for (var i = 0; i < lineView.rest.length; i++)
                    lineView.measure.caches[i] = {};
        }
    }

    function clearLineMeasurementCache(cm) {
        cm.display.externalMeasure = null;
        removeChildren(cm.display.lineMeasure);
        for (var i = 0; i < cm.display.view.length; i++)
            clearLineMeasurementCacheFor(cm.display.view[i]);
    }

    function clearCaches(cm) {
        clearLineMeasurementCache(cm);
        cm.display.cachedCharWidth = cm.display.cachedTextHeight = cm.display.cachedPaddingH = null;
        if (!cm.options.lineWrapping)
            cm.display.maxLineChanged = true;
        cm.display.lineNumChars = null;
    }

    function pageScrollX() {
        return window.pageXOffset || (document.documentElement || document.body).scrollLeft;
    }
    function pageScrollY() {
        return window.pageYOffset || (document.documentElement || document.body).scrollTop;
    }

    // Converts a {top, bottom, left, right} box from line-local
    // coordinates into another coordinate system. Context may be one of
    // "line", "div" (display.lineDiv), "local"/null (editor), or "page".
    function intoCoordSystem(cm, lineObj, rect, context) {
        if (lineObj.widgets)
            for (var i = 0; i < lineObj.widgets.length; ++i)
                if (lineObj.widgets[i].above) {
                    var size = widgetHeight(lineObj.widgets[i]);
                    rect.top += size;
                    rect.bottom += size;
                }
        if (context == "line")
            return rect;
        if (!context)
            context = "local";
        var yOff = heightAtLine(lineObj);
        if (context == "local")
            yOff += paddingTop(cm.display);
        else
            yOff -= cm.display.viewOffset;
        if (context == "page" || context == "window") {
            var lOff = cm.display.lineSpace.getBoundingClientRect();
            yOff += lOff.top + (context == "window" ? 0 : pageScrollY());
            var xOff = lOff.left + (context == "window" ? 0 : pageScrollX());
            rect.left += xOff;
            rect.right += xOff;
        }
        rect.top += yOff;
        rect.bottom += yOff;
        return rect;
    }

    // Coverts a box from "div" coords to another coordinate system.
    // Context may be "window", "page", "div", or "local"/null.
    function fromCoordSystem(cm, coords, context) {
        if (context == "div")
            return coords;
        var left = coords.left, top = coords.top;
        // First move into "page" coordinate system
        if (context == "page") {
            left -= pageScrollX();
            top -= pageScrollY();
        } else if (context == "local" || !context) {
            var localBox = cm.display.sizer.getBoundingClientRect();
            left += localBox.left;
            top += localBox.top;
        }

        var lineSpaceBox = cm.display.lineSpace.getBoundingClientRect();
        return {left: left - lineSpaceBox.left, top: top - lineSpaceBox.top};
    }

    function charCoords(cm, pos, context, lineObj, bias) {
        if (!lineObj)
            lineObj = getLine(cm.doc, pos.line);
        return intoCoordSystem(cm, lineObj, measureChar(cm, lineObj, pos.ch, bias), context);
    }

    // Returns a box for a given cursor position, which may have an
    // 'other' property containing the position of the secondary cursor
    // on a bidi boundary.
    function cursorCoords(cm, pos, context, lineObj, preparedMeasure) {
        lineObj = lineObj || getLine(cm.doc, pos.line);
        if (!preparedMeasure)
            preparedMeasure = prepareMeasureForLine(cm, lineObj);
        function get(ch, right) {
            var m = measureCharPrepared(cm, preparedMeasure, ch, right ? "right" : "left");
            if (right)
                m.left = m.right;
            else
                m.right = m.left;
            return intoCoordSystem(cm, lineObj, m, context);
        }
        function getBidi(ch, partPos) {
            var part = order[partPos], right = part.level % 2;
            if (ch == bidiLeft(part) && partPos && part.level < order[partPos - 1].level) {
                part = order[--partPos];
                ch = bidiRight(part) - (part.level % 2 ? 0 : 1);
                right = true;
            } else if (ch == bidiRight(part) && partPos < order.length - 1 && part.level < order[partPos + 1].level) {
                part = order[++partPos];
                ch = bidiLeft(part) - part.level % 2;
                right = false;
            }
            if (right && ch == part.to && ch > part.from)
                return get(ch - 1);
            return get(ch, right);
        }
        var order = getOrder(lineObj), ch = pos.ch;
        if (!order)
            return get(ch);
        var partPos = getBidiPartAt(order, ch);
        var val = getBidi(ch, partPos);
        if (bidiOther != null)
            val.other = getBidi(ch, bidiOther);
        return val;
    }

    // Used to cheaply estimate the coordinates for a position. Used for
    // intermediate scroll updates.
    function estimateCoords(cm, pos) {
        var left = 0, pos = clipPos(cm.doc, pos);
        if (!cm.options.lineWrapping)
            left = charWidth(cm.display) * pos.ch;
        var lineObj = getLine(cm.doc, pos.line);
        var top = heightAtLine(lineObj) + paddingTop(cm.display);
        return {left: left, right: left, top: top, bottom: top + lineObj.height};
    }

    // Positions returned by coordsChar contain some extra information.
    // xRel is the relative x position of the input coordinates compared
    // to the found position (so xRel > 0 means the coordinates are to
    // the right of the character position, for example). When outside
    // is true, that means the coordinates lie outside the line's
    // vertical range.
    function PosWithInfo(line, ch, outside, xRel) {
        var pos = Pos(line, ch);
        pos.xRel = xRel;
        if (outside)
            pos.outside = true;
        return pos;
    }

    // Compute the character position closest to the given coordinates.
    // Input must be lineSpace-local ("div" coordinate system).
    function coordsChar(cm, x, y) {
        var doc = cm.doc;
        y += cm.display.viewOffset;
        if (y < 0)
            return PosWithInfo(doc.first, 0, true, -1);
        var lineN = lineAtHeight(doc, y), last = doc.first + doc.size - 1;
        if (lineN > last)
            return PosWithInfo(doc.first + doc.size - 1, getLine(doc, last).text.length, true, 1);
        if (x < 0)
            x = 0;

        var lineObj = getLine(doc, lineN);
        for (; ; ) {
            var found = coordsCharInner(cm, lineObj, lineN, x, y);
            var merged = collapsedSpanAtEnd(lineObj);
            var mergedPos = merged && merged.find(0, true);
            if (merged && (found.ch > mergedPos.from.ch || found.ch == mergedPos.from.ch && found.xRel > 0))
                lineN = lineNo(lineObj = mergedPos.to.line);
            else
                return found;
        }
    }

    function coordsCharInner(cm, lineObj, lineNo, x, y) {
        var innerOff = y - heightAtLine(lineObj);
        var wrongLine = false, adjust = 2 * cm.display.wrapper.clientWidth;
        var preparedMeasure = prepareMeasureForLine(cm, lineObj);

        function getX(ch) {
            var sp = cursorCoords(cm, Pos(lineNo, ch), "line", lineObj, preparedMeasure);
            wrongLine = true;
            if (innerOff > sp.bottom)
                return sp.left - adjust;
            else if (innerOff < sp.top)
                return sp.left + adjust;
            else
                wrongLine = false;
            return sp.left;
        }

        var bidi = getOrder(lineObj), dist = lineObj.text.length;
        var from = lineLeft(lineObj), to = lineRight(lineObj);
        var fromX = getX(from), fromOutside = wrongLine, toX = getX(to), toOutside = wrongLine;

        if (x > toX)
            return PosWithInfo(lineNo, to, toOutside, 1);
        // Do a binary search between these bounds.
        for (; ; ) {
            if (bidi ? to == from || to == moveVisually(lineObj, from, 1) : to - from <= 1) {
                var ch = x < fromX || x - fromX <= toX - x ? from : to;
                var xDiff = x - (ch == from ? fromX : toX);
                while (isExtendingChar(lineObj.text.charAt(ch)))
                    ++ch;
                var pos = PosWithInfo(lineNo, ch, ch == from ? fromOutside : toOutside,
                        xDiff < -1 ? -1 : xDiff > 1 ? 1 : 0);
                return pos;
            }
            var step = Math.ceil(dist / 2), middle = from + step;
            if (bidi) {
                middle = from;
                for (var i = 0; i < step; ++i)
                    middle = moveVisually(lineObj, middle, 1);
            }
            var middleX = getX(middle);
            if (middleX > x) {
                to = middle;
                toX = middleX;
                if (toOutside = wrongLine)
                    toX += 1000;
                dist = step;
            } else {
                from = middle;
                fromX = middleX;
                fromOutside = wrongLine;
                dist -= step;
            }
        }
    }

    var measureText;
    // Compute the default text height.
    function textHeight(display) {
        if (display.cachedTextHeight != null)
            return display.cachedTextHeight;
        if (measureText == null) {
            measureText = elt("pre");
            // Measure a bunch of lines, for browsers that compute
            // fractional heights.
            for (var i = 0; i < 49; ++i) {
                measureText.appendChild(document.createTextNode("x"));
                measureText.appendChild(elt("br"));
            }
            measureText.appendChild(document.createTextNode("x"));
        }
        removeChildrenAndAdd(display.measure, measureText);
        var height = measureText.offsetHeight / 50;
        if (height > 3)
            display.cachedTextHeight = height;
        removeChildren(display.measure);
        return height || 1;
    }

    // Compute the default character width.
    function charWidth(display) {
        if (display.cachedCharWidth != null)
            return display.cachedCharWidth;
        var anchor = elt("span", "xxxxxxxxxx");
        var pre = elt("pre", [anchor]);
        removeChildrenAndAdd(display.measure, pre);
        var rect = anchor.getBoundingClientRect(), width = (rect.right - rect.left) / 10;
        if (width > 2)
            display.cachedCharWidth = width;
        return width || 10;
    }

    // OPERATIONS

    // Operations are used to wrap a series of changes to the editor
    // state in such a way that each change won't have to update the
    // cursor and display (which would be awkward, slow, and
    // error-prone). Instead, display updates are batched and then all
    // combined and executed at once.

    var nextOpId = 0;
    // Start a new operation.
    function startOperation(cm) {
        cm.curOp = {
            viewChanged: false, // Flag that indicates that lines might need to be redrawn
            startHeight: cm.doc.height, // Used to detect need to update scrollbar
            forceUpdate: false, // Used to force a redraw
            updateInput: null, // Whether to reset the input textarea
            typing: false, // Whether this reset should be careful to leave existing text (for compositing)
            changeObjs: null, // Accumulated changes, for firing change events
            cursorActivityHandlers: null, // Set of handlers to fire cursorActivity on
            selectionChanged: false, // Whether the selection needs to be redrawn
            updateMaxLine: false, // Set when the widest line needs to be determined anew
            scrollLeft: null, scrollTop: null, // Intermediate scroll position, not pushed to DOM yet
            scrollToPos: null, // Used to scroll to a specific position
            id: ++nextOpId           // Unique ID
        };
        if (!delayedCallbackDepth++)
            delayedCallbacks = [];
    }

    // Finish an operation, updating the display and signalling delayed events
    function endOperation(cm) {
        var op = cm.curOp, doc = cm.doc, display = cm.display;
        cm.curOp = null;

        if (op.updateMaxLine)
            findMaxLine(cm);

        // If it looks like an update might be needed, call updateDisplay
        if (op.viewChanged || op.forceUpdate || op.scrollTop != null ||
                op.scrollToPos && (op.scrollToPos.from.line < display.viewFrom ||
                        op.scrollToPos.to.line >= display.viewTo) ||
                display.maxLineChanged && cm.options.lineWrapping) {
            var updated = updateDisplay(cm, {top: op.scrollTop, ensure: op.scrollToPos}, op.forceUpdate);
            if (cm.display.scroller.offsetHeight)
                cm.doc.scrollTop = cm.display.scroller.scrollTop;
        }
        // If no update was run, but the selection changed, redraw that.
        if (!updated && op.selectionChanged)
            updateSelection(cm);
        if (!updated && op.startHeight != cm.doc.height)
            updateScrollbars(cm);

        // Propagate the scroll position to the actual DOM scroller
        if (op.scrollTop != null && display.scroller.scrollTop != op.scrollTop) {
            var top = Math.max(0, Math.min(display.scroller.scrollHeight - display.scroller.clientHeight, op.scrollTop));
            display.scroller.scrollTop = display.scrollbarV.scrollTop = doc.scrollTop = top;
        }
        if (op.scrollLeft != null && display.scroller.scrollLeft != op.scrollLeft) {
            var left = Math.max(0, Math.min(display.scroller.scrollWidth - display.scroller.clientWidth, op.scrollLeft));
            display.scroller.scrollLeft = display.scrollbarH.scrollLeft = doc.scrollLeft = left;
            alignHorizontally(cm);
        }
        // If we need to scroll a specific position into view, do so.
        if (op.scrollToPos) {
            var coords = scrollPosIntoView(cm, clipPos(cm.doc, op.scrollToPos.from),
                    clipPos(cm.doc, op.scrollToPos.to), op.scrollToPos.margin);
            if (op.scrollToPos.isCursor && cm.state.focused)
                maybeScrollWindow(cm, coords);
        }

        if (op.selectionChanged)
            restartBlink(cm);

        if (cm.state.focused && op.updateInput)
            resetInput(cm, op.typing);

        // Fire events for markers that are hidden/unidden by editing or
        // undoing
        var hidden = op.maybeHiddenMarkers, unhidden = op.maybeUnhiddenMarkers;
        if (hidden)
            for (var i = 0; i < hidden.length; ++i)
                if (!hidden[i].lines.length)
                    signal(hidden[i], "hide");
        if (unhidden)
            for (var i = 0; i < unhidden.length; ++i)
                if (unhidden[i].lines.length)
                    signal(unhidden[i], "unhide");

        var delayed;
        if (!--delayedCallbackDepth) {
            delayed = delayedCallbacks;
            delayedCallbacks = null;
        }
        // Fire change events, and delayed event handlers
        if (op.changeObjs)
            signal(cm, "changes", cm, op.changeObjs);
        if (delayed)
            for (var i = 0; i < delayed.length; ++i)
                delayed[i]();
        if (op.cursorActivityHandlers)
            for (var i = 0; i < op.cursorActivityHandlers.length; i++)
                op.cursorActivityHandlers[i](cm);
    }

    // Run the given function in an operation
    function runInOp(cm, f) {
        if (cm.curOp)
            return f();
        startOperation(cm);
        try {
            return f();
        } finally {
            endOperation(cm);
        }
    }
    // Wraps a function in an operation. Returns the wrapped function.
    function operation(cm, f) {
        return function () {
            if (cm.curOp)
                return f.apply(cm, arguments);
            startOperation(cm);
            try {
                return f.apply(cm, arguments);
            } finally {
                endOperation(cm);
            }
        };
    }
    // Used to add methods to editor and doc instances, wrapping them in
    // operations.
    function methodOp(f) {
        return function () {
            if (this.curOp)
                return f.apply(this, arguments);
            startOperation(this);
            try {
                return f.apply(this, arguments);
            } finally {
                endOperation(this);
            }
        };
    }
    function docMethodOp(f) {
        return function () {
            var cm = this.cm;
            if (!cm || cm.curOp)
                return f.apply(this, arguments);
            startOperation(cm);
            try {
                return f.apply(this, arguments);
            } finally {
                endOperation(cm);
            }
        };
    }

    // VIEW TRACKING

    // These objects are used to represent the visible (currently drawn)
    // part of the document. A LineView may correspond to multiple
    // logical lines, if those are connected by collapsed ranges.
    function LineView(doc, line, lineN) {
        // The starting line
        this.line = line;
        // Continuing lines, if any
        this.rest = visualLineContinued(line);
        // Number of logical lines in this visual line
        this.size = this.rest ? lineNo(lst(this.rest)) - lineN + 1 : 1;
        this.node = this.text = null;
        this.hidden = lineIsHidden(doc, line);
    }

    // Create a range of LineView objects for the given lines.
    function buildViewArray(cm, from, to) {
        var array = [], nextPos;
        for (var pos = from; pos < to; pos = nextPos) {
            var view = new LineView(cm.doc, getLine(cm.doc, pos), pos);
            nextPos = pos + view.size;
            array.push(view);
        }
        return array;
    }

    // Updates the display.view data structure for a given change to the
    // document. From and to are in pre-change coordinates. Lendiff is
    // the amount of lines added or subtracted by the change. This is
    // used for changes that span multiple lines, or change the way
    // lines are divided into visual lines. regLineChange (below)
    // registers single-line changes.
    function regChange(cm, from, to, lendiff) {
        if (from == null)
            from = cm.doc.first;
        if (to == null)
            to = cm.doc.first + cm.doc.size;
        if (!lendiff)
            lendiff = 0;

        var display = cm.display;
        if (lendiff && to < display.viewTo &&
                (display.updateLineNumbers == null || display.updateLineNumbers > from))
            display.updateLineNumbers = from;

        cm.curOp.viewChanged = true;

        if (from >= display.viewTo) { // Change after
            if (sawCollapsedSpans && visualLineNo(cm.doc, from) < display.viewTo)
                resetView(cm);
        } else if (to <= display.viewFrom) { // Change before
            if (sawCollapsedSpans && visualLineEndNo(cm.doc, to + lendiff) > display.viewFrom) {
                resetView(cm);
            } else {
                display.viewFrom += lendiff;
                display.viewTo += lendiff;
            }
        } else if (from <= display.viewFrom && to >= display.viewTo) { // Full overlap
            resetView(cm);
        } else if (from <= display.viewFrom) { // Top overlap
            var cut = viewCuttingPoint(cm, to, to + lendiff, 1);
            if (cut) {
                display.view = display.view.slice(cut.index);
                display.viewFrom = cut.lineN;
                display.viewTo += lendiff;
            } else {
                resetView(cm);
            }
        } else if (to >= display.viewTo) { // Bottom overlap
            var cut = viewCuttingPoint(cm, from, from, -1);
            if (cut) {
                display.view = display.view.slice(0, cut.index);
                display.viewTo = cut.lineN;
            } else {
                resetView(cm);
            }
        } else { // Gap in the middle
            var cutTop = viewCuttingPoint(cm, from, from, -1);
            var cutBot = viewCuttingPoint(cm, to, to + lendiff, 1);
            if (cutTop && cutBot) {
                display.view = display.view.slice(0, cutTop.index)
                        .concat(buildViewArray(cm, cutTop.lineN, cutBot.lineN))
                        .concat(display.view.slice(cutBot.index));
                display.viewTo += lendiff;
            } else {
                resetView(cm);
            }
        }

        var ext = display.externalMeasured;
        if (ext) {
            if (to < ext.lineN)
                ext.lineN += lendiff;
            else if (from < ext.lineN + ext.size)
                display.externalMeasured = null;
        }
    }

    // Register a change to a single line. Type must be one of "text",
    // "gutter", "class", "widget"
    function regLineChange(cm, line, type) {
        cm.curOp.viewChanged = true;
        var display = cm.display, ext = cm.display.externalMeasured;
        if (ext && line >= ext.lineN && line < ext.lineN + ext.size)
            display.externalMeasured = null;

        if (line < display.viewFrom || line >= display.viewTo)
            return;
        var lineView = display.view[findViewIndex(cm, line)];
        if (lineView.node == null)
            return;
        var arr = lineView.changes || (lineView.changes = []);
        if (indexOf(arr, type) == -1)
            arr.push(type);
    }

    // Clear the view.
    function resetView(cm) {
        cm.display.viewFrom = cm.display.viewTo = cm.doc.first;
        cm.display.view = [];
        cm.display.viewOffset = 0;
    }

    // Find the view element corresponding to a given line. Return null
    // when the line isn't visible.
    function findViewIndex(cm, n) {
        if (n >= cm.display.viewTo)
            return null;
        n -= cm.display.viewFrom;
        if (n < 0)
            return null;
        var view = cm.display.view;
        for (var i = 0; i < view.length; i++) {
            n -= view[i].size;
            if (n < 0)
                return i;
        }
    }

    function viewCuttingPoint(cm, oldN, newN, dir) {
        var index = findViewIndex(cm, oldN), diff, view = cm.display.view;
        if (!sawCollapsedSpans)
            return {index: index, lineN: newN};
        for (var i = 0, n = cm.display.viewFrom; i < index; i++)
            n += view[i].size;
        if (n != oldN) {
            if (dir > 0) {
                if (index == view.length - 1)
                    return null;
                diff = (n + view[index].size) - oldN;
                index++;
            } else {
                diff = n - oldN;
            }
            oldN += diff;
            newN += diff;
        }
        while (visualLineNo(cm.doc, newN) != newN) {
            if (index == (dir < 0 ? 0 : view.length - 1))
                return null;
            newN += dir * view[index - (dir < 0 ? 1 : 0)].size;
            index += dir;
        }
        return {index: index, lineN: newN};
    }

    // Force the view to cover a given range, adding empty view element
    // or clipping off existing ones as needed.
    function adjustView(cm, from, to) {
        var display = cm.display, view = display.view;
        if (view.length == 0 || from >= display.viewTo || to <= display.viewFrom) {
            display.view = buildViewArray(cm, from, to);
            display.viewFrom = from;
        } else {
            if (display.viewFrom > from)
                display.view = buildViewArray(cm, from, display.viewFrom).concat(display.view);
            else if (display.viewFrom < from)
                display.view = display.view.slice(findViewIndex(cm, from));
            display.viewFrom = from;
            if (display.viewTo < to)
                display.view = display.view.concat(buildViewArray(cm, display.viewTo, to));
            else if (display.viewTo > to)
                display.view = display.view.slice(0, findViewIndex(cm, to));
        }
        display.viewTo = to;
    }

    // Count the number of lines in the view whose DOM representation is
    // out of date (or nonexistent).
    function countDirtyView(cm) {
        var view = cm.display.view, dirty = 0;
        for (var i = 0; i < view.length; i++) {
            var lineView = view[i];
            if (!lineView.hidden && (!lineView.node || lineView.changes))
                ++dirty;
        }
        return dirty;
    }

    // INPUT HANDLING

    // Poll for input changes, using the normal rate of polling. This
    // runs as long as the editor is focused.
    function slowPoll(cm) {
        if (cm.display.pollingFast)
            return;
        cm.display.poll.set(cm.options.pollInterval, function () {
            readInput(cm);
            if (cm.state.focused)
                slowPoll(cm);
        });
    }

    // When an event has just come in that is likely to add or change
    // something in the input textarea, we poll faster, to ensure that
    // the change appears on the screen quickly.
    function fastPoll(cm) {
        var missed = false;
        cm.display.pollingFast = true;
        function p() {
            var changed = readInput(cm);
            if (!changed && !missed) {
                missed = true;
                cm.display.poll.set(60, p);
            } else {
                cm.display.pollingFast = false;
                slowPoll(cm);
            }
        }
        cm.display.poll.set(20, p);
    }

    // Read input from the textarea, and update the document to match.
    // When something is selected, it is present in the textarea, and
    // selected (unless it is huge, in which case a placeholder is
    // used). When nothing is selected, the cursor sits after previously
    // seen text (can be empty), which is stored in prevInput (we must
    // not reset the textarea when typing, because that breaks IME).
    function readInput(cm) {
        var input = cm.display.input, prevInput = cm.display.prevInput, doc = cm.doc;
        // Since this is called a *lot*, try to bail out as cheaply as
        // possible when it is clear that nothing happened. hasSelection
        // will be the case when there is a lot of text in the textarea,
        // in which case reading its value would be expensive.
        if (!cm.state.focused || (hasSelection(input) && !prevInput) || isReadOnly(cm) || cm.options.disableInput)
            return false;
        // See paste handler for more on the fakedLastChar kludge
        if (cm.state.pasteIncoming && cm.state.fakedLastChar) {
            input.value = input.value.substring(0, input.value.length - 1);
            cm.state.fakedLastChar = false;
        }
        var text = input.value;
        // If nothing changed, bail.
        if (text == prevInput && !cm.somethingSelected())
            return false;
        // Work around nonsensical selection resetting in IE9/10
        if (ie && !ie_upto8 && cm.display.inputHasSelection === text) {
            resetInput(cm);
            return false;
        }

        var withOp = !cm.curOp;
        if (withOp)
            startOperation(cm);
        cm.display.shift = false;

        // Find the part of the input that is actually new
        var same = 0, l = Math.min(prevInput.length, text.length);
        while (same < l && prevInput.charCodeAt(same) == text.charCodeAt(same))
            ++same;
        var inserted = text.slice(same), textLines = splitLines(inserted);

        // When pasing N lines into N selections, insert one line per selection
        var multiPaste = cm.state.pasteIncoming && textLines.length > 1 && doc.sel.ranges.length == textLines.length;

        // Normal behavior is to insert the new text into every selection
        for (var i = doc.sel.ranges.length - 1; i >= 0; i--) {
            var range = doc.sel.ranges[i];
            var from = range.from(), to = range.to();
            // Handle deletion
            if (same < prevInput.length)
                from = Pos(from.line, from.ch - (prevInput.length - same));
            // Handle overwrite
            else if (cm.state.overwrite && range.empty() && !cm.state.pasteIncoming)
                to = Pos(to.line, Math.min(getLine(doc, to.line).text.length, to.ch + lst(textLines).length));
            var updateInput = cm.curOp.updateInput;
            var changeEvent = {from: from, to: to, text: multiPaste ? [textLines[i]] : textLines,
                origin: cm.state.pasteIncoming ? "paste" : cm.state.cutIncoming ? "cut" : "+input"};
            makeChange(cm.doc, changeEvent);
            signalLater(cm, "inputRead", cm, changeEvent);
            // When an 'electric' character is inserted, immediately trigger a reindent
            if (inserted && !cm.state.pasteIncoming && cm.options.electricChars &&
                    cm.options.smartIndent && range.head.ch < 100 &&
                    (!i || doc.sel.ranges[i - 1].head.line != range.head.line)) {
                var mode = cm.getModeAt(range.head);
                if (mode.electricChars) {
                    for (var j = 0; j < mode.electricChars.length; j++)
                        if (inserted.indexOf(mode.electricChars.charAt(j)) > -1) {
                            indentLine(cm, range.head.line, "smart");
                            break;
                        }
                } else if (mode.electricInput) {
                    var end = changeEnd(changeEvent);
                    if (mode.electricInput.test(getLine(doc, end.line).text.slice(0, end.ch)))
                        indentLine(cm, range.head.line, "smart");
                }
            }
        }
        ensureCursorVisible(cm);
        cm.curOp.updateInput = updateInput;
        cm.curOp.typing = true;

        // Don't leave long text in the textarea, since it makes further polling slow
        if (text.length > 1000 || text.indexOf("\n") > -1)
            input.value = cm.display.prevInput = "";
        else
            cm.display.prevInput = text;
        if (withOp)
            endOperation(cm);
        cm.state.pasteIncoming = cm.state.cutIncoming = false;
        return true;
    }

    // Reset the input to correspond to the selection (or to be empty,
    // when not typing and nothing is selected)
    function resetInput(cm, typing) {
        var minimal, selected, doc = cm.doc;
        if (cm.somethingSelected()) {
            cm.display.prevInput = "";
            var range = doc.sel.primary();
            minimal = hasCopyEvent &&
                    (range.to().line - range.from().line > 100 || (selected = cm.getSelection()).length > 1000);
            var content = minimal ? "-" : selected || cm.getSelection();
            cm.display.input.value = content;
            if (cm.state.focused)
                selectInput(cm.display.input);
            if (ie && !ie_upto8)
                cm.display.inputHasSelection = content;
        } else if (!typing) {
            cm.display.prevInput = cm.display.input.value = "";
            if (ie && !ie_upto8)
                cm.display.inputHasSelection = null;
        }
        cm.display.inaccurateSelection = minimal;
    }

    function focusInput(cm) {
        if (cm.options.readOnly != "nocursor" && (!mobile || activeElt() != cm.display.input))
            cm.display.input.focus();
    }

    function ensureFocus(cm) {
        if (!cm.state.focused) {
            focusInput(cm);
            onFocus(cm);
        }
    }

    function isReadOnly(cm) {
        return cm.options.readOnly || cm.doc.cantEdit;
    }

    // EVENT HANDLERS

    // Attach the necessary event handlers when initializing the editor
    function registerEventHandlers(cm) {
        var d = cm.display;
        on(d.scroller, "mousedown", operation(cm, onMouseDown));
        // Older IE's will not fire a second mousedown for a double click
        if (ie_upto10)
            on(d.scroller, "dblclick", operation(cm, function (e) {
                if (signalDOMEvent(cm, e))
                    return;
                var pos = posFromMouse(cm, e);
                if (!pos || clickInGutter(cm, e) || eventInWidget(cm.display, e))
                    return;
                e_preventDefault(e);
                var word = findWordAt(cm.doc, pos);
                extendSelection(cm.doc, word.anchor, word.head);
            }));
        else
            on(d.scroller, "dblclick", function (e) {
                signalDOMEvent(cm, e) || e_preventDefault(e);
            });
        // Prevent normal selection in the editor (we handle our own)
        on(d.lineSpace, "selectstart", function (e) {
            if (!eventInWidget(d, e))
                e_preventDefault(e);
        });
        // Some browsers fire contextmenu *after* opening the menu, at
        // which point we can't mess with it anymore. Context menu is
        // handled in onMouseDown for these browsers.
        if (!captureRightClick)
            on(d.scroller, "contextmenu", function (e) {
                onContextMenu(cm, e);
            });

        // Sync scrolling between fake scrollbars and real scrollable
        // area, ensure viewport is updated when scrolling.
        on(d.scroller, "scroll", function () {
            if (d.scroller.clientHeight) {
                setScrollTop(cm, d.scroller.scrollTop);
                setScrollLeft(cm, d.scroller.scrollLeft, true);
                signal(cm, "scroll", cm);
            }
        });
        on(d.scrollbarV, "scroll", function () {
            if (d.scroller.clientHeight)
                setScrollTop(cm, d.scrollbarV.scrollTop);
        });
        on(d.scrollbarH, "scroll", function () {
            if (d.scroller.clientHeight)
                setScrollLeft(cm, d.scrollbarH.scrollLeft);
        });

        // Listen to wheel events in order to try and update the viewport on time.
        on(d.scroller, "mousewheel", function (e) {
            onScrollWheel(cm, e);
        });
        on(d.scroller, "DOMMouseScroll", function (e) {
            onScrollWheel(cm, e);
        });

        // Prevent clicks in the scrollbars from killing focus
        function reFocus() {
            if (cm.state.focused)
                setTimeout(bind(focusInput, cm), 0);
        }
        on(d.scrollbarH, "mousedown", reFocus);
        on(d.scrollbarV, "mousedown", reFocus);
        // Prevent wrapper from ever scrolling
        on(d.wrapper, "scroll", function () {
            d.wrapper.scrollTop = d.wrapper.scrollLeft = 0;
        });

        // When the window resizes, we need to refresh active editors.
        var resizeTimer;
        function onResize() {
            if (resizeTimer == null)
                resizeTimer = setTimeout(function () {
                    resizeTimer = null;
                    // Might be a text scaling operation, clear size caches.
                    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = knownScrollbarWidth = null;
                    cm.setSize();
                }, 100);
        }
        on(window, "resize", onResize);
        // The above handler holds on to the editor and its data
        // structures. Here we poll to unregister it when the editor is no
        // longer in the document, so that it can be garbage-collected.
        function unregister() {
            if (contains(document.body, d.wrapper))
                setTimeout(unregister, 5000);
            else
                off(window, "resize", onResize);
        }
        setTimeout(unregister, 5000);

        on(d.input, "keyup", operation(cm, onKeyUp));
        on(d.input, "input", function () {
            if (ie && !ie_upto8 && cm.display.inputHasSelection)
                cm.display.inputHasSelection = null;
            fastPoll(cm);
        });
        on(d.input, "keydown", operation(cm, onKeyDown));
        on(d.input, "keypress", operation(cm, onKeyPress));
        on(d.input, "focus", bind(onFocus, cm));
        on(d.input, "blur", bind(onBlur, cm));

        function drag_(e) {
            if (!signalDOMEvent(cm, e))
                e_stop(e);
        }
        if (cm.options.dragDrop) {
            on(d.scroller, "dragstart", function (e) {
                onDragStart(cm, e);
            });
            on(d.scroller, "dragenter", drag_);
            on(d.scroller, "dragover", drag_);
            on(d.scroller, "drop", operation(cm, onDrop));
        }
        on(d.scroller, "paste", function (e) {
            if (eventInWidget(d, e))
                return;
            cm.state.pasteIncoming = true;
            focusInput(cm);
            fastPoll(cm);
        });
        on(d.input, "paste", function () {
            // Workaround for webkit bug https://bugs.webkit.org/show_bug.cgi?id=90206
            // Add a char to the end of textarea before paste occur so that
            // selection doesn't span to the end of textarea.
            if (webkit && !cm.state.fakedLastChar && !(new Date - cm.state.lastMiddleDown < 200)) {
                var start = d.input.selectionStart, end = d.input.selectionEnd;
                d.input.value += "$";
                d.input.selectionStart = start;
                d.input.selectionEnd = end;
                cm.state.fakedLastChar = true;
            }
            cm.state.pasteIncoming = true;
            fastPoll(cm);
        });

        function prepareCopyCut(e) {
            if (cm.somethingSelected()) {
                if (d.inaccurateSelection) {
                    d.prevInput = "";
                    d.inaccurateSelection = false;
                    d.input.value = cm.getSelection();
                    selectInput(d.input);
                }
            } else {
                var text = "", ranges = [];
                for (var i = 0; i < cm.doc.sel.ranges.length; i++) {
                    var line = cm.doc.sel.ranges[i].head.line;
                    var lineRange = {anchor: Pos(line, 0), head: Pos(line + 1, 0)};
                    ranges.push(lineRange);
                    text += cm.getRange(lineRange.anchor, lineRange.head);
                }
                if (e.type == "cut") {
                    cm.setSelections(ranges, null, sel_dontScroll);
                } else {
                    d.prevInput = "";
                    d.input.value = text;
                    selectInput(d.input);
                }
            }
            if (e.type == "cut")
                cm.state.cutIncoming = true;
        }
        on(d.input, "cut", prepareCopyCut);
        on(d.input, "copy", prepareCopyCut);

        // Needed to handle Tab key in KHTML
        if (khtml)
            on(d.sizer, "mouseup", function () {
                if (activeElt() == d.input)
                    d.input.blur();
                focusInput(cm);
            });
    }

    // MOUSE EVENTS

    // Return true when the given mouse event happened in a widget
    function eventInWidget(display, e) {
        for (var n = e_target(e); n != display.wrapper; n = n.parentNode) {
            if (!n || n.ignoreEvents || n.parentNode == display.sizer && n != display.mover)
                return true;
        }
    }

    // Given a mouse event, find the corresponding position. If liberal
    // is false, it checks whether a gutter or scrollbar was clicked,
    // and returns null if it was. forRect is used by rectangular
    // selections, and tries to estimate a character position even for
    // coordinates beyond the right of the text.
    function posFromMouse(cm, e, liberal, forRect) {
        var display = cm.display;
        if (!liberal) {
            var target = e_target(e);
            if (target == display.scrollbarH || target == display.scrollbarV ||
                    target == display.scrollbarFiller || target == display.gutterFiller)
                return null;
        }
        var x, y, space = display.lineSpace.getBoundingClientRect();
        // Fails unpredictably on IE[67] when mouse is dragged around quickly.
        try {
            x = e.clientX - space.left;
            y = e.clientY - space.top;
        } catch (e) {
            return null;
        }
        var coords = coordsChar(cm, x, y), line;
        if (forRect && coords.xRel == 1 && (line = getLine(cm.doc, coords.line).text).length == coords.ch) {
            var colDiff = countColumn(line, line.length, cm.options.tabSize) - line.length;
            coords = Pos(coords.line, Math.max(0, Math.round((x - paddingH(cm.display).left) / charWidth(cm.display)) - colDiff));
        }
        return coords;
    }

    // A mouse down can be a single click, double click, triple click,
    // start of selection drag, start of text drag, new cursor
    // (ctrl-click), rectangle drag (alt-drag), or xwin
    // middle-click-paste. Or it might be a click on something we should
    // not interfere with, such as a scrollbar or widget.
    function onMouseDown(e) {
        if (signalDOMEvent(this, e))
            return;
        var cm = this, display = cm.display;
        display.shift = e.shiftKey;

        if (eventInWidget(display, e)) {
            if (!webkit) {
                // Briefly turn off draggability, to allow widgets to do
                // normal dragging things.
                display.scroller.draggable = false;
                setTimeout(function () {
                    display.scroller.draggable = true;
                }, 100);
            }
            return;
        }
        if (clickInGutter(cm, e))
            return;
        var start = posFromMouse(cm, e);
        window.focus();

        switch (e_button(e)) {
            case 1:
                if (start)
                    leftButtonDown(cm, e, start);
                else if (e_target(e) == display.scroller)
                    e_preventDefault(e);
                break;
            case 2:
                if (webkit)
                    cm.state.lastMiddleDown = +new Date;
                if (start)
                    extendSelection(cm.doc, start);
                setTimeout(bind(focusInput, cm), 20);
                e_preventDefault(e);
                break;
            case 3:
                if (captureRightClick)
                    onContextMenu(cm, e);
                break;
        }
    }

    var lastClick, lastDoubleClick;
    function leftButtonDown(cm, e, start) {
        setTimeout(bind(ensureFocus, cm), 0);

        var now = +new Date, type;
        if (lastDoubleClick && lastDoubleClick.time > now - 400 && cmp(lastDoubleClick.pos, start) == 0) {
            type = "triple";
        } else if (lastClick && lastClick.time > now - 400 && cmp(lastClick.pos, start) == 0) {
            type = "double";
            lastDoubleClick = {time: now, pos: start};
        } else {
            type = "single";
            lastClick = {time: now, pos: start};
        }

        var sel = cm.doc.sel, addNew = mac ? e.metaKey : e.ctrlKey;
        if (cm.options.dragDrop && dragAndDrop && !addNew && !isReadOnly(cm) &&
                type == "single" && sel.contains(start) > -1 && sel.somethingSelected())
            leftButtonStartDrag(cm, e, start);
        else
            leftButtonSelect(cm, e, start, type, addNew);
    }

    // Start a text drag. When it ends, see if any dragging actually
    // happen, and treat as a click if it didn't.
    function leftButtonStartDrag(cm, e, start) {
        var display = cm.display;
        var dragEnd = operation(cm, function (e2) {
            if (webkit)
                display.scroller.draggable = false;
            cm.state.draggingText = false;
            off(document, "mouseup", dragEnd);
            off(display.scroller, "drop", dragEnd);
            if (Math.abs(e.clientX - e2.clientX) + Math.abs(e.clientY - e2.clientY) < 10) {
                e_preventDefault(e2);
                extendSelection(cm.doc, start);
                focusInput(cm);
                // Work around unexplainable focus problem in IE9 (#2127)
                if (ie_upto10 && !ie_upto8)
                    setTimeout(function () {
                        document.body.focus();
                        focusInput(cm);
                    }, 20);
            }
        });
        // Let the drag handler handle this.
        if (webkit)
            display.scroller.draggable = true;
        cm.state.draggingText = dragEnd;
        // IE's approach to draggable
        if (display.scroller.dragDrop)
            display.scroller.dragDrop();
        on(document, "mouseup", dragEnd);
        on(display.scroller, "drop", dragEnd);
    }

    // Normal selection, as opposed to text dragging.
    function leftButtonSelect(cm, e, start, type, addNew) {
        var display = cm.display, doc = cm.doc;
        e_preventDefault(e);

        var ourRange, ourIndex, startSel = doc.sel;
        if (addNew && !e.shiftKey) {
            ourIndex = doc.sel.contains(start);
            if (ourIndex > -1)
                ourRange = doc.sel.ranges[ourIndex];
            else
                ourRange = new Range(start, start);
        } else {
            ourRange = doc.sel.primary();
        }

        if (e.altKey) {
            type = "rect";
            if (!addNew)
                ourRange = new Range(start, start);
            start = posFromMouse(cm, e, true, true);
            ourIndex = -1;
        } else if (type == "double") {
            var word = findWordAt(doc, start);
            if (cm.display.shift || doc.extend)
                ourRange = extendRange(doc, ourRange, word.anchor, word.head);
            else
                ourRange = word;
        } else if (type == "triple") {
            var line = new Range(Pos(start.line, 0), clipPos(doc, Pos(start.line + 1, 0)));
            if (cm.display.shift || doc.extend)
                ourRange = extendRange(doc, ourRange, line.anchor, line.head);
            else
                ourRange = line;
        } else {
            ourRange = extendRange(doc, ourRange, start);
        }

        if (!addNew) {
            ourIndex = 0;
            setSelection(doc, new Selection([ourRange], 0), sel_mouse);
            startSel = doc.sel;
        } else if (ourIndex > -1) {
            replaceOneSelection(doc, ourIndex, ourRange, sel_mouse);
        } else {
            ourIndex = doc.sel.ranges.length;
            setSelection(doc, normalizeSelection(doc.sel.ranges.concat([ourRange]), ourIndex),
                    {scroll: false, origin: "*mouse"});
        }

        var lastPos = start;
        function extendTo(pos) {
            if (cmp(lastPos, pos) == 0)
                return;
            lastPos = pos;

            if (type == "rect") {
                var ranges = [], tabSize = cm.options.tabSize;
                var startCol = countColumn(getLine(doc, start.line).text, start.ch, tabSize);
                var posCol = countColumn(getLine(doc, pos.line).text, pos.ch, tabSize);
                var left = Math.min(startCol, posCol), right = Math.max(startCol, posCol);
                for (var line = Math.min(start.line, pos.line), end = Math.min(cm.lastLine(), Math.max(start.line, pos.line));
                        line <= end; line++) {
                    var text = getLine(doc, line).text, leftPos = findColumn(text, left, tabSize);
                    if (left == right)
                        ranges.push(new Range(Pos(line, leftPos), Pos(line, leftPos)));
                    else if (text.length > leftPos)
                        ranges.push(new Range(Pos(line, leftPos), Pos(line, findColumn(text, right, tabSize))));
                }
                if (!ranges.length)
                    ranges.push(new Range(start, start));
                setSelection(doc, normalizeSelection(startSel.ranges.slice(0, ourIndex).concat(ranges), ourIndex), sel_mouse);
            } else {
                var oldRange = ourRange;
                var anchor = oldRange.anchor, head = pos;
                if (type != "single") {
                    if (type == "double")
                        var range = findWordAt(doc, pos);
                    else
                        var range = new Range(Pos(pos.line, 0), clipPos(doc, Pos(pos.line + 1, 0)));
                    if (cmp(range.anchor, anchor) > 0) {
                        head = range.head;
                        anchor = minPos(oldRange.from(), range.anchor);
                    } else {
                        head = range.anchor;
                        anchor = maxPos(oldRange.to(), range.head);
                    }
                }
                var ranges = startSel.ranges.slice(0);
                ranges[ourIndex] = new Range(clipPos(doc, anchor), head);
                setSelection(doc, normalizeSelection(ranges, ourIndex), sel_mouse);
            }
        }

        var editorSize = display.wrapper.getBoundingClientRect();
        // Used to ensure timeout re-tries don't fire when another extend
        // happened in the meantime (clearTimeout isn't reliable -- at
        // least on Chrome, the timeouts still happen even when cleared,
        // if the clear happens after their scheduled firing time).
        var counter = 0;

        function extend(e) {
            var curCount = ++counter;
            var cur = posFromMouse(cm, e, true, type == "rect");
            if (!cur)
                return;
            if (cmp(cur, lastPos) != 0) {
                ensureFocus(cm);
                extendTo(cur);
                var visible = visibleLines(display, doc);
                if (cur.line >= visible.to || cur.line < visible.from)
                    setTimeout(operation(cm, function () {
                        if (counter == curCount)
                            extend(e);
                    }), 150);
            } else {
                var outside = e.clientY < editorSize.top ? -20 : e.clientY > editorSize.bottom ? 20 : 0;
                if (outside)
                    setTimeout(operation(cm, function () {
                        if (counter != curCount)
                            return;
                        display.scroller.scrollTop += outside;
                        extend(e);
                    }), 50);
            }
        }

        function done(e) {
            counter = Infinity;
            e_preventDefault(e);
            focusInput(cm);
            off(document, "mousemove", move);
            off(document, "mouseup", up);
            doc.history.lastSelOrigin = null;
        }

        var move = operation(cm, function (e) {
            if ((ie && !ie_upto9) ? !e.buttons : !e_button(e))
                done(e);
            else
                extend(e);
        });
        var up = operation(cm, done);
        on(document, "mousemove", move);
        on(document, "mouseup", up);
    }

    // Determines whether an event happened in the gutter, and fires the
    // handlers for the corresponding event.
    function gutterEvent(cm, e, type, prevent, signalfn) {
        try {
            var mX = e.clientX, mY = e.clientY;
        } catch (e) {
            return false;
        }
        if (mX >= Math.floor(cm.display.gutters.getBoundingClientRect().right))
            return false;
        if (prevent)
            e_preventDefault(e);

        var display = cm.display;
        var lineBox = display.lineDiv.getBoundingClientRect();

        if (mY > lineBox.bottom || !hasHandler(cm, type))
            return e_defaultPrevented(e);
        mY -= lineBox.top - display.viewOffset;

        for (var i = 0; i < cm.options.gutters.length; ++i) {
            var g = display.gutters.childNodes[i];
            if (g && g.getBoundingClientRect().right >= mX) {
                var line = lineAtHeight(cm.doc, mY);
                var gutter = cm.options.gutters[i];
                signalfn(cm, type, cm, line, gutter, e);
                return e_defaultPrevented(e);
            }
        }
    }

    function clickInGutter(cm, e) {
        return gutterEvent(cm, e, "gutterClick", true, signalLater);
    }

    // Kludge to work around strange IE behavior where it'll sometimes
    // re-fire a series of drag-related events right after the drop (#1551)
    var lastDrop = 0;

    function onDrop(e) {
        var cm = this;
        if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e))
            return;
        e_preventDefault(e);
        if (ie)
            lastDrop = +new Date;
        var pos = posFromMouse(cm, e, true), files = e.dataTransfer.files;
        if (!pos || isReadOnly(cm))
            return;
        // Might be a file drop, in which case we simply extract the text
        // and insert it.
        if (files && files.length && window.FileReader && window.File) {
            var n = files.length, text = Array(n), read = 0;
            var loadFile = function (file, i) {
                var reader = new FileReader;
                reader.onload = operation(cm, function () {
                    text[i] = reader.result;
                    if (++read == n) {
                        pos = clipPos(cm.doc, pos);
                        var change = {from: pos, to: pos, text: splitLines(text.join("\n")), origin: "paste"};
                        makeChange(cm.doc, change);
                        setSelectionReplaceHistory(cm.doc, simpleSelection(pos, changeEnd(change)));
                    }
                });
                reader.readAsText(file);
            };
            for (var i = 0; i < n; ++i)
                loadFile(files[i], i);
        } else { // Normal drop
            // Don't do a replace if the drop happened inside of the selected text.
            if (cm.state.draggingText && cm.doc.sel.contains(pos) > -1) {
                cm.state.draggingText(e);
                // Ensure the editor is re-focused
                setTimeout(bind(focusInput, cm), 20);
                return;
            }
            try {
                var text = e.dataTransfer.getData("Text");
                if (text) {
                    var selected = cm.state.draggingText && cm.listSelections();
                    setSelectionNoUndo(cm.doc, simpleSelection(pos, pos));
                    if (selected)
                        for (var i = 0; i < selected.length; ++i)
                            replaceRange(cm.doc, "", selected[i].anchor, selected[i].head, "drag");
                    cm.replaceSelection(text, "around", "paste");
                    focusInput(cm);
                }
            } catch (e) {
            }
        }
    }

    function onDragStart(cm, e) {
        if (ie && (!cm.state.draggingText || +new Date - lastDrop < 100)) {
            e_stop(e);
            return;
        }
        if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e))
            return;

        e.dataTransfer.setData("Text", cm.getSelection());

        // Use dummy image instead of default browsers image.
        // Recent Safari (~6.0.2) have a tendency to segfault when this happens, so we don't do it there.
        if (e.dataTransfer.setDragImage && !safari) {
            var img = elt("img", null, null, "position: fixed; left: 0; top: 0;");
            img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
            if (presto) {
                img.width = img.height = 1;
                cm.display.wrapper.appendChild(img);
                // Force a relayout, or Opera won't use our image for some obscure reason
                img._top = img.offsetTop;
            }
            e.dataTransfer.setDragImage(img, 0, 0);
            if (presto)
                img.parentNode.removeChild(img);
        }
    }

    // SCROLL EVENTS

    // Sync the scrollable area and scrollbars, ensure the viewport
    // covers the visible area.
    function setScrollTop(cm, val) {
        if (Math.abs(cm.doc.scrollTop - val) < 2)
            return;
        cm.doc.scrollTop = val;
        if (!gecko)
            updateDisplay(cm, {top: val});
        if (cm.display.scroller.scrollTop != val)
            cm.display.scroller.scrollTop = val;
        if (cm.display.scrollbarV.scrollTop != val)
            cm.display.scrollbarV.scrollTop = val;
        if (gecko)
            updateDisplay(cm);
        startWorker(cm, 100);
    }
    // Sync scroller and scrollbar, ensure the gutter elements are
    // aligned.
    function setScrollLeft(cm, val, isScroller) {
        if (isScroller ? val == cm.doc.scrollLeft : Math.abs(cm.doc.scrollLeft - val) < 2)
            return;
        val = Math.min(val, cm.display.scroller.scrollWidth - cm.display.scroller.clientWidth);
        cm.doc.scrollLeft = val;
        alignHorizontally(cm);
        if (cm.display.scroller.scrollLeft != val)
            cm.display.scroller.scrollLeft = val;
        if (cm.display.scrollbarH.scrollLeft != val)
            cm.display.scrollbarH.scrollLeft = val;
    }

    // Since the delta values reported on mouse wheel events are
    // unstandardized between browsers and even browser versions, and
    // generally horribly unpredictable, this code starts by measuring
    // the scroll effect that the first few mouse wheel events have,
    // and, from that, detects the way it can convert deltas to pixel
    // offsets afterwards.
    //
    // The reason we want to know the amount a wheel event will scroll
    // is that it gives us a chance to update the display before the
    // actual scrolling happens, reducing flickering.

    var wheelSamples = 0, wheelPixelsPerUnit = null;
    // Fill in a browser-detected starting value on browsers where we
    // know one. These don't have to be accurate -- the result of them
    // being wrong would just be a slight flicker on the first wheel
    // scroll (if it is large enough).
    if (ie)
        wheelPixelsPerUnit = -.53;
    else if (gecko)
        wheelPixelsPerUnit = 15;
    else if (chrome)
        wheelPixelsPerUnit = -.7;
    else if (safari)
        wheelPixelsPerUnit = -1 / 3;

    function onScrollWheel(cm, e) {
        var dx = e.wheelDeltaX, dy = e.wheelDeltaY;
        if (dx == null && e.detail && e.axis == e.HORIZONTAL_AXIS)
            dx = e.detail;
        if (dy == null && e.detail && e.axis == e.VERTICAL_AXIS)
            dy = e.detail;
        else if (dy == null)
            dy = e.wheelDelta;

        var display = cm.display, scroll = display.scroller;
        // Quit if there's nothing to scroll here
        if (!(dx && scroll.scrollWidth > scroll.clientWidth ||
                dy && scroll.scrollHeight > scroll.clientHeight))
            return;

        // Webkit browsers on OS X abort momentum scrolls when the target
        // of the scroll event is removed from the scrollable element.
        // This hack (see related code in patchDisplay) makes sure the
        // element is kept around.
        if (dy && mac && webkit) {
            outer: for (var cur = e.target, view = display.view; cur != scroll; cur = cur.parentNode) {
                for (var i = 0; i < view.length; i++) {
                    if (view[i].node == cur) {
                        cm.display.currentWheelTarget = cur;
                        break outer;
                    }
                }
            }
        }

        // On some browsers, horizontal scrolling will cause redraws to
        // happen before the gutter has been realigned, causing it to
        // wriggle around in a most unseemly way. When we have an
        // estimated pixels/delta value, we just handle horizontal
        // scrolling entirely here. It'll be slightly off from native, but
        // better than glitching out.
        if (dx && !gecko && !presto && wheelPixelsPerUnit != null) {
            if (dy)
                setScrollTop(cm, Math.max(0, Math.min(scroll.scrollTop + dy * wheelPixelsPerUnit, scroll.scrollHeight - scroll.clientHeight)));
            setScrollLeft(cm, Math.max(0, Math.min(scroll.scrollLeft + dx * wheelPixelsPerUnit, scroll.scrollWidth - scroll.clientWidth)));
            e_preventDefault(e);
            display.wheelStartX = null; // Abort measurement, if in progress
            return;
        }

        // 'Project' the visible viewport to cover the area that is being
        // scrolled into view (if we know enough to estimate it).
        if (dy && wheelPixelsPerUnit != null) {
            var pixels = dy * wheelPixelsPerUnit;
            var top = cm.doc.scrollTop, bot = top + display.wrapper.clientHeight;
            if (pixels < 0)
                top = Math.max(0, top + pixels - 50);
            else
                bot = Math.min(cm.doc.height, bot + pixels + 50);
            updateDisplay(cm, {top: top, bottom: bot});
        }

        if (wheelSamples < 20) {
            if (display.wheelStartX == null) {
                display.wheelStartX = scroll.scrollLeft;
                display.wheelStartY = scroll.scrollTop;
                display.wheelDX = dx;
                display.wheelDY = dy;
                setTimeout(function () {
                    if (display.wheelStartX == null)
                        return;
                    var movedX = scroll.scrollLeft - display.wheelStartX;
                    var movedY = scroll.scrollTop - display.wheelStartY;
                    var sample = (movedY && display.wheelDY && movedY / display.wheelDY) ||
                            (movedX && display.wheelDX && movedX / display.wheelDX);
                    display.wheelStartX = display.wheelStartY = null;
                    if (!sample)
                        return;
                    wheelPixelsPerUnit = (wheelPixelsPerUnit * wheelSamples + sample) / (wheelSamples + 1);
                    ++wheelSamples;
                }, 200);
            } else {
                display.wheelDX += dx;
                display.wheelDY += dy;
            }
        }
    }

    // KEY EVENTS

    // Run a handler that was bound to a key.
    function doHandleBinding(cm, bound, dropShift) {
        if (typeof bound == "string") {
            bound = commands[bound];
            if (!bound)
                return false;
        }
        // Ensure previous input has been read, so that the handler sees a
        // consistent view of the document
        if (cm.display.pollingFast && readInput(cm))
            cm.display.pollingFast = false;
        var prevShift = cm.display.shift, done = false;
        try {
            if (isReadOnly(cm))
                cm.state.suppressEdits = true;
            if (dropShift)
                cm.display.shift = false;
            done = bound(cm) != Pass;
        } finally {
            cm.display.shift = prevShift;
            cm.state.suppressEdits = false;
        }
        return done;
    }

    // Collect the currently active keymaps.
    function allKeyMaps(cm) {
        var maps = cm.state.keyMaps.slice(0);
        if (cm.options.extraKeys)
            maps.push(cm.options.extraKeys);
        maps.push(cm.options.keyMap);
        return maps;
    }

    var maybeTransition;
    // Handle a key from the keydown event.
    function handleKeyBinding(cm, e) {
        // Handle automatic keymap transitions
        var startMap = getKeyMap(cm.options.keyMap), next = startMap.auto;
        clearTimeout(maybeTransition);
        if (next && !isModifierKey(e))
            maybeTransition = setTimeout(function () {
                if (getKeyMap(cm.options.keyMap) == startMap) {
                    cm.options.keyMap = (next.call ? next.call(null, cm) : next);
                    keyMapChanged(cm);
                }
            }, 50);

        var name = keyName(e, true), handled = false;
        if (!name)
            return false;
        var keymaps = allKeyMaps(cm);

        if (e.shiftKey) {
            // First try to resolve full name (including 'Shift-'). Failing
            // that, see if there is a cursor-motion command (starting with
            // 'go') bound to the keyname without 'Shift-'.
            handled = lookupKey("Shift-" + name, keymaps, function (b) {
                return doHandleBinding(cm, b, true);
            })
                    || lookupKey(name, keymaps, function (b) {
                        if (typeof b == "string" ? /^go[A-Z]/.test(b) : b.motion)
                            return doHandleBinding(cm, b);
                    });
        } else {
            handled = lookupKey(name, keymaps, function (b) {
                return doHandleBinding(cm, b);
            });
        }

        if (handled) {
            e_preventDefault(e);
            restartBlink(cm);
            signalLater(cm, "keyHandled", cm, name, e);
        }
        return handled;
    }

    // Handle a key from the keypress event
    function handleCharBinding(cm, e, ch) {
        var handled = lookupKey("'" + ch + "'", allKeyMaps(cm),
                function (b) {
                    return doHandleBinding(cm, b, true);
                });
        if (handled) {
            e_preventDefault(e);
            restartBlink(cm);
            signalLater(cm, "keyHandled", cm, "'" + ch + "'", e);
        }
        return handled;
    }

    var lastStoppedKey = null;
    function onKeyDown(e) {
        var cm = this;
        ensureFocus(cm);
        if (signalDOMEvent(cm, e))
            return;
        // IE does strange things with escape.
        if (ie_upto10 && e.keyCode == 27)
            e.returnValue = false;
        var code = e.keyCode;
        cm.display.shift = code == 16 || e.shiftKey;
        var handled = handleKeyBinding(cm, e);
        if (presto) {
            lastStoppedKey = handled ? code : null;
            // Opera has no cut event... we try to at least catch the key combo
            if (!handled && code == 88 && !hasCopyEvent && (mac ? e.metaKey : e.ctrlKey))
                cm.replaceSelection("", null, "cut");
        }

        // Turn mouse into crosshair when Alt is held on Mac.
        if (code == 18 && !/\bCodeMirror-crosshair\b/.test(cm.display.lineDiv.className))
            showCrossHair(cm);
    }

    function showCrossHair(cm) {
        var lineDiv = cm.display.lineDiv;
        addClass(lineDiv, "CodeMirror-crosshair");

        function up(e) {
            if (e.keyCode == 18 || !e.altKey) {
                rmClass(lineDiv, "CodeMirror-crosshair");
                off(document, "keyup", up);
                off(document, "mouseover", up);
            }
        }
        on(document, "keyup", up);
        on(document, "mouseover", up);
    }

    function onKeyUp(e) {
        if (signalDOMEvent(this, e))
            return;
        if (e.keyCode == 16)
            this.doc.sel.shift = false;
    }

    function onKeyPress(e) {
        var cm = this;
        if (signalDOMEvent(cm, e))
            return;
        var keyCode = e.keyCode, charCode = e.charCode;
        if (presto && keyCode == lastStoppedKey) {
            lastStoppedKey = null;
            e_preventDefault(e);
            return;
        }
        if (((presto && (!e.which || e.which < 10)) || khtml) && handleKeyBinding(cm, e))
            return;
        var ch = String.fromCharCode(charCode == null ? keyCode : charCode);
        if (handleCharBinding(cm, e, ch))
            return;
        if (ie && !ie_upto8)
            cm.display.inputHasSelection = null;
        fastPoll(cm);
    }

    // FOCUS/BLUR EVENTS

    function onFocus(cm) {
        if (cm.options.readOnly == "nocursor")
            return;
        if (!cm.state.focused) {
            signal(cm, "focus", cm);
            cm.state.focused = true;
            addClass(cm.display.wrapper, "CodeMirror-focused");
            // The prevInput test prevents this from firing when a context
            // menu is closed (since the resetInput would kill the
            // select-all detection hack)
            if (!cm.curOp && cm.display.selForContextMenu == cm.doc.sel) {
                resetInput(cm);
                if (webkit)
                    setTimeout(bind(resetInput, cm, true), 0); // Issue #1730
            }
        }
        slowPoll(cm);
        restartBlink(cm);
    }
    function onBlur(cm) {
        if (cm.state.focused) {
            signal(cm, "blur", cm);
            cm.state.focused = false;
            rmClass(cm.display.wrapper, "CodeMirror-focused");
        }
        clearInterval(cm.display.blinker);
        setTimeout(function () {
            if (!cm.state.focused)
                cm.display.shift = false;
        }, 150);
    }

    // CONTEXT MENU HANDLING

    var detectingSelectAll;
    // To make the context menu work, we need to briefly unhide the
    // textarea (making it as unobtrusive as possible) to let the
    // right-click take effect on it.
    function onContextMenu(cm, e) {
        if (signalDOMEvent(cm, e, "contextmenu"))
            return;
        var display = cm.display;
        if (eventInWidget(display, e) || contextMenuInGutter(cm, e))
            return;

        var pos = posFromMouse(cm, e), scrollPos = display.scroller.scrollTop;
        if (!pos || presto)
            return; // Opera is difficult.

        // Reset the current text selection only if the click is done outside of the selection
        // and 'resetSelectionOnContextMenu' option is true.
        var reset = cm.options.resetSelectionOnContextMenu;
        if (reset && cm.doc.sel.contains(pos) == -1)
            operation(cm, setSelection)(cm.doc, simpleSelection(pos), sel_dontScroll);

        var oldCSS = display.input.style.cssText;
        display.inputDiv.style.position = "absolute";
        display.input.style.cssText = "position: fixed; width: 30px; height: 30px; top: " + (e.clientY - 5) +
                "px; left: " + (e.clientX - 5) + "px; z-index: 1000; background: " +
                (ie ? "rgba(255, 255, 255, .05)" : "transparent") +
                "; outline: none; border-width: 0; outline: none; overflow: hidden; opacity: .05; filter: alpha(opacity=5);";
        focusInput(cm);
        resetInput(cm);
        // Adds "Select all" to context menu in FF
        if (!cm.somethingSelected())
            display.input.value = display.prevInput = " ";
        display.selForContextMenu = cm.doc.sel;

        // Select-all will be greyed out if there's nothing to select, so
        // this adds a zero-width space so that we can later check whether
        // it got selected.
        function prepareSelectAllHack() {
            if (display.input.selectionStart != null) {
                var selected = cm.somethingSelected();
                var extval = display.input.value = "\u200b" + (selected ? display.input.value : "");
                display.prevInput = selected ? "" : "\u200b";
                display.input.selectionStart = 1;
                display.input.selectionEnd = extval.length;
            }
        }
        function rehide() {
            display.inputDiv.style.position = "relative";
            display.input.style.cssText = oldCSS;
            if (ie_upto8)
                display.scrollbarV.scrollTop = display.scroller.scrollTop = scrollPos;
            slowPoll(cm);

            // Try to detect the user choosing select-all
            if (display.input.selectionStart != null) {
                if (!ie || ie_upto8)
                    prepareSelectAllHack();
                clearTimeout(detectingSelectAll);
                var i = 0, poll = function () {
                    if (display.selForContextMenu == cm.doc.sel && display.input.selectionStart == 0)
                        operation(cm, commands.selectAll)(cm);
                    else if (i++ < 10)
                        detectingSelectAll = setTimeout(poll, 500);
                    else
                        resetInput(cm);
                };
                detectingSelectAll = setTimeout(poll, 200);
            }
        }

        if (ie && !ie_upto8)
            prepareSelectAllHack();
        if (captureRightClick) {
            e_stop(e);
            var mouseup = function () {
                off(window, "mouseup", mouseup);
                setTimeout(rehide, 20);
            };
            on(window, "mouseup", mouseup);
        } else {
            setTimeout(rehide, 50);
        }
    }

    function contextMenuInGutter(cm, e) {
        if (!hasHandler(cm, "gutterContextMenu"))
            return false;
        return gutterEvent(cm, e, "gutterContextMenu", false, signal);
    }

    // UPDATING

    // Compute the position of the end of a change (its 'to' property
    // refers to the pre-change end).
    var changeEnd = CodeMirror.changeEnd = function (change) {
        if (!change.text)
            return change.to;
        return Pos(change.from.line + change.text.length - 1,
                lst(change.text).length + (change.text.length == 1 ? change.from.ch : 0));
    };

    // Adjust a position to refer to the post-change position of the
    // same text, or the end of the change if the change covers it.
    function adjustForChange(pos, change) {
        if (cmp(pos, change.from) < 0)
            return pos;
        if (cmp(pos, change.to) <= 0)
            return changeEnd(change);

        var line = pos.line + change.text.length - (change.to.line - change.from.line) - 1, ch = pos.ch;
        if (pos.line == change.to.line)
            ch += changeEnd(change).ch - change.to.ch;
        return Pos(line, ch);
    }

    function computeSelAfterChange(doc, change) {
        var out = [];
        for (var i = 0; i < doc.sel.ranges.length; i++) {
            var range = doc.sel.ranges[i];
            out.push(new Range(adjustForChange(range.anchor, change),
                    adjustForChange(range.head, change)));
        }
        return normalizeSelection(out, doc.sel.primIndex);
    }

    function offsetPos(pos, old, nw) {
        if (pos.line == old.line)
            return Pos(nw.line, pos.ch - old.ch + nw.ch);
        else
            return Pos(nw.line + (pos.line - old.line), pos.ch);
    }

    // Used by replaceSelections to allow moving the selection to the
    // start or around the replaced test. Hint may be "start" or "around".
    function computeReplacedSel(doc, changes, hint) {
        var out = [];
        var oldPrev = Pos(doc.first, 0), newPrev = oldPrev;
        for (var i = 0; i < changes.length; i++) {
            var change = changes[i];
            var from = offsetPos(change.from, oldPrev, newPrev);
            var to = offsetPos(changeEnd(change), oldPrev, newPrev);
            oldPrev = change.to;
            newPrev = to;
            if (hint == "around") {
                var range = doc.sel.ranges[i], inv = cmp(range.head, range.anchor) < 0;
                out[i] = new Range(inv ? to : from, inv ? from : to);
            } else {
                out[i] = new Range(from, from);
            }
        }
        return new Selection(out, doc.sel.primIndex);
    }

    // Allow "beforeChange" event handlers to influence a change
    function filterChange(doc, change, update) {
        var obj = {
            canceled: false,
            from: change.from,
            to: change.to,
            text: change.text,
            origin: change.origin,
            cancel: function () {
                this.canceled = true;
            }
        };
        if (update)
            obj.update = function (from, to, text, origin) {
                if (from)
                    this.from = clipPos(doc, from);
                if (to)
                    this.to = clipPos(doc, to);
                if (text)
                    this.text = text;
                if (origin !== undefined)
                    this.origin = origin;
            };
        signal(doc, "beforeChange", doc, obj);
        if (doc.cm)
            signal(doc.cm, "beforeChange", doc.cm, obj);

        if (obj.canceled)
            return null;
        return {from: obj.from, to: obj.to, text: obj.text, origin: obj.origin};
    }

    // Apply a change to a document, and add it to the document's
    // history, and propagating it to all linked documents.
    function makeChange(doc, change, ignoreReadOnly) {
        if (doc.cm) {
            if (!doc.cm.curOp)
                return operation(doc.cm, makeChange)(doc, change, ignoreReadOnly);
            if (doc.cm.state.suppressEdits)
                return;
        }

        if (hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange")) {
            change = filterChange(doc, change, true);
            if (!change)
                return;
        }

        // Possibly split or suppress the update based on the presence
        // of read-only spans in its range.
        var split = sawReadOnlySpans && !ignoreReadOnly && removeReadOnlyRanges(doc, change.from, change.to);
        if (split) {
            for (var i = split.length - 1; i >= 0; --i)
                makeChangeInner(doc, {from: split[i].from, to: split[i].to, text: i ? [""] : change.text});
        } else {
            makeChangeInner(doc, change);
        }
    }

    function makeChangeInner(doc, change) {
        if (change.text.length == 1 && change.text[0] == "" && cmp(change.from, change.to) == 0)
            return;
        var selAfter = computeSelAfterChange(doc, change);
        addChangeToHistory(doc, change, selAfter, doc.cm ? doc.cm.curOp.id : NaN);

        makeChangeSingleDoc(doc, change, selAfter, stretchSpansOverChange(doc, change));
        var rebased = [];

        linkedDocs(doc, function (doc, sharedHist) {
            if (!sharedHist && indexOf(rebased, doc.history) == -1) {
                rebaseHist(doc.history, change);
                rebased.push(doc.history);
            }
            makeChangeSingleDoc(doc, change, null, stretchSpansOverChange(doc, change));
        });
    }

    // Revert a change stored in a document's history.
    function makeChangeFromHistory(doc, type, allowSelectionOnly) {
        if (doc.cm && doc.cm.state.suppressEdits)
            return;

        var hist = doc.history, event, selAfter = doc.sel;
        var source = type == "undo" ? hist.done : hist.undone, dest = type == "undo" ? hist.undone : hist.done;

        // Verify that there is a useable event (so that ctrl-z won't
        // needlessly clear selection events)
        for (var i = 0; i < source.length; i++) {
            event = source[i];
            if (allowSelectionOnly ? event.ranges && !event.equals(doc.sel) : !event.ranges)
                break;
        }
        if (i == source.length)
            return;
        hist.lastOrigin = hist.lastSelOrigin = null;

        for (; ; ) {
            event = source.pop();
            if (event.ranges) {
                pushSelectionToHistory(event, dest);
                if (allowSelectionOnly && !event.equals(doc.sel)) {
                    setSelection(doc, event, {clearRedo: false});
                    return;
                }
                selAfter = event;
            } else
                break;
        }

        // Build up a reverse change object to add to the opposite history
        // stack (redo when undoing, and vice versa).
        var antiChanges = [];
        pushSelectionToHistory(selAfter, dest);
        dest.push({changes: antiChanges, generation: hist.generation});
        hist.generation = event.generation || ++hist.maxGeneration;

        var filter = hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange");

        for (var i = event.changes.length - 1; i >= 0; --i) {
            var change = event.changes[i];
            change.origin = type;
            if (filter && !filterChange(doc, change, false)) {
                source.length = 0;
                return;
            }

            antiChanges.push(historyChangeFromChange(doc, change));

            var after = i ? computeSelAfterChange(doc, change, null) : lst(source);
            makeChangeSingleDoc(doc, change, after, mergeOldSpans(doc, change));
            if (doc.cm)
                ensureCursorVisible(doc.cm);
            var rebased = [];

            // Propagate to the linked documents
            linkedDocs(doc, function (doc, sharedHist) {
                if (!sharedHist && indexOf(rebased, doc.history) == -1) {
                    rebaseHist(doc.history, change);
                    rebased.push(doc.history);
                }
                makeChangeSingleDoc(doc, change, null, mergeOldSpans(doc, change));
            });
        }
    }

    // Sub-views need their line numbers shifted when text is added
    // above or below them in the parent document.
    function shiftDoc(doc, distance) {
        doc.first += distance;
        doc.sel = new Selection(map(doc.sel.ranges, function (range) {
            return new Range(Pos(range.anchor.line + distance, range.anchor.ch),
                    Pos(range.head.line + distance, range.head.ch));
        }), doc.sel.primIndex);
        if (doc.cm)
            regChange(doc.cm, doc.first, doc.first - distance, distance);
    }

    // More lower-level change function, handling only a single document
    // (not linked ones).
    function makeChangeSingleDoc(doc, change, selAfter, spans) {
        if (doc.cm && !doc.cm.curOp)
            return operation(doc.cm, makeChangeSingleDoc)(doc, change, selAfter, spans);

        if (change.to.line < doc.first) {
            shiftDoc(doc, change.text.length - 1 - (change.to.line - change.from.line));
            return;
        }
        if (change.from.line > doc.lastLine())
            return;

        // Clip the change to the size of this doc
        if (change.from.line < doc.first) {
            var shift = change.text.length - 1 - (doc.first - change.from.line);
            shiftDoc(doc, shift);
            change = {from: Pos(doc.first, 0), to: Pos(change.to.line + shift, change.to.ch),
                text: [lst(change.text)], origin: change.origin};
        }
        var last = doc.lastLine();
        if (change.to.line > last) {
            change = {from: change.from, to: Pos(last, getLine(doc, last).text.length),
                text: [change.text[0]], origin: change.origin};
        }

        change.removed = getBetween(doc, change.from, change.to);

        if (!selAfter)
            selAfter = computeSelAfterChange(doc, change, null);
        if (doc.cm)
            makeChangeSingleDocInEditor(doc.cm, change, spans);
        else
            updateDoc(doc, change, spans);
        setSelectionNoUndo(doc, selAfter, sel_dontScroll);
    }

    // Handle the interaction of a change to a document with the editor
    // that this document is part of.
    function makeChangeSingleDocInEditor(cm, change, spans) {
        var doc = cm.doc, display = cm.display, from = change.from, to = change.to;

        var recomputeMaxLength = false, checkWidthStart = from.line;
        if (!cm.options.lineWrapping) {
            checkWidthStart = lineNo(visualLine(getLine(doc, from.line)));
            doc.iter(checkWidthStart, to.line + 1, function (line) {
                if (line == display.maxLine) {
                    recomputeMaxLength = true;
                    return true;
                }
            });
        }

        if (doc.sel.contains(change.from, change.to) > -1)
            signalCursorActivity(cm);

        updateDoc(doc, change, spans, estimateHeight(cm));

        if (!cm.options.lineWrapping) {
            doc.iter(checkWidthStart, from.line + change.text.length, function (line) {
                var len = lineLength(line);
                if (len > display.maxLineLength) {
                    display.maxLine = line;
                    display.maxLineLength = len;
                    display.maxLineChanged = true;
                    recomputeMaxLength = false;
                }
            });
            if (recomputeMaxLength)
                cm.curOp.updateMaxLine = true;
        }

        // Adjust frontier, schedule worker
        doc.frontier = Math.min(doc.frontier, from.line);
        startWorker(cm, 400);

        var lendiff = change.text.length - (to.line - from.line) - 1;
        // Remember that these lines changed, for updating the display
        if (from.line == to.line && change.text.length == 1 && !isWholeLineUpdate(cm.doc, change))
            regLineChange(cm, from.line, "text");
        else
            regChange(cm, from.line, to.line + 1, lendiff);

        var changesHandler = hasHandler(cm, "changes"), changeHandler = hasHandler(cm, "change");
        if (changeHandler || changesHandler) {
            var obj = {
                from: from, to: to,
                text: change.text,
                removed: change.removed,
                origin: change.origin
            };
            if (changeHandler)
                signalLater(cm, "change", cm, obj);
            if (changesHandler)
                (cm.curOp.changeObjs || (cm.curOp.changeObjs = [])).push(obj);
        }
    }

    function replaceRange(doc, code, from, to, origin) {
        if (!to)
            to = from;
        if (cmp(to, from) < 0) {
            var tmp = to;
            to = from;
            from = tmp;
        }
        if (typeof code == "string")
            code = splitLines(code);
        makeChange(doc, {from: from, to: to, text: code, origin: origin});
    }

    // SCROLLING THINGS INTO VIEW

    // If an editor sits on the top or bottom of the window, partially
    // scrolled out of view, this ensures that the cursor is visible.
    function maybeScrollWindow(cm, coords) {
        var display = cm.display, box = display.sizer.getBoundingClientRect(), doScroll = null;
        if (coords.top + box.top < 0)
            doScroll = true;
        else if (coords.bottom + box.top > (window.innerHeight || document.documentElement.clientHeight))
            doScroll = false;
        if (doScroll != null && !phantom) {
            var scrollNode = elt("div", "\u200b", null, "position: absolute; top: " +
                    (coords.top - display.viewOffset - paddingTop(cm.display)) + "px; height: " +
                    (coords.bottom - coords.top + scrollerCutOff) + "px; left: " +
                    coords.left + "px; width: 2px;");
            cm.display.lineSpace.appendChild(scrollNode);
            scrollNode.scrollIntoView(doScroll);
            cm.display.lineSpace.removeChild(scrollNode);
        }
    }

    // Scroll a given position into view (immediately), verifying that
    // it actually became visible (as line heights are accurately
    // measured, the position of something may 'drift' during drawing).
    function scrollPosIntoView(cm, pos, end, margin) {
        if (margin == null)
            margin = 0;
        for (; ; ) {
            var changed = false, coords = cursorCoords(cm, pos);
            var endCoords = !end || end == pos ? coords : cursorCoords(cm, end);
            var scrollPos = calculateScrollPos(cm, Math.min(coords.left, endCoords.left),
                    Math.min(coords.top, endCoords.top) - margin,
                    Math.max(coords.left, endCoords.left),
                    Math.max(coords.bottom, endCoords.bottom) + margin);
            var startTop = cm.doc.scrollTop, startLeft = cm.doc.scrollLeft;
            if (scrollPos.scrollTop != null) {
                setScrollTop(cm, scrollPos.scrollTop);
                if (Math.abs(cm.doc.scrollTop - startTop) > 1)
                    changed = true;
            }
            if (scrollPos.scrollLeft != null) {
                setScrollLeft(cm, scrollPos.scrollLeft);
                if (Math.abs(cm.doc.scrollLeft - startLeft) > 1)
                    changed = true;
            }
            if (!changed)
                return coords;
        }
    }

    // Scroll a given set of coordinates into view (immediately).
    function scrollIntoView(cm, x1, y1, x2, y2) {
        var scrollPos = calculateScrollPos(cm, x1, y1, x2, y2);
        if (scrollPos.scrollTop != null)
            setScrollTop(cm, scrollPos.scrollTop);
        if (scrollPos.scrollLeft != null)
            setScrollLeft(cm, scrollPos.scrollLeft);
    }

    // Calculate a new scroll position needed to scroll the given
    // rectangle into view. Returns an object with scrollTop and
    // scrollLeft properties. When these are undefined, the
    // vertical/horizontal position does not need to be adjusted.
    function calculateScrollPos(cm, x1, y1, x2, y2) {
        var display = cm.display, snapMargin = textHeight(cm.display);
        if (y1 < 0)
            y1 = 0;
        var screentop = cm.curOp && cm.curOp.scrollTop != null ? cm.curOp.scrollTop : display.scroller.scrollTop;
        var screen = display.scroller.clientHeight - scrollerCutOff, result = {};
        var docBottom = cm.doc.height + paddingVert(display);
        var atTop = y1 < snapMargin, atBottom = y2 > docBottom - snapMargin;
        if (y1 < screentop) {
            result.scrollTop = atTop ? 0 : y1;
        } else if (y2 > screentop + screen) {
            var newTop = Math.min(y1, (atBottom ? docBottom : y2) - screen);
            if (newTop != screentop)
                result.scrollTop = newTop;
        }

        var screenleft = cm.curOp && cm.curOp.scrollLeft != null ? cm.curOp.scrollLeft : display.scroller.scrollLeft;
        var screenw = display.scroller.clientWidth - scrollerCutOff;
        x1 += display.gutters.offsetWidth;
        x2 += display.gutters.offsetWidth;
        var gutterw = display.gutters.offsetWidth;
        var atLeft = x1 < gutterw + 10;
        if (x1 < screenleft + gutterw || atLeft) {
            if (atLeft)
                x1 = 0;
            result.scrollLeft = Math.max(0, x1 - 10 - gutterw);
        } else if (x2 > screenw + screenleft - 3) {
            result.scrollLeft = x2 + 10 - screenw;
        }
        return result;
    }

    // Store a relative adjustment to the scroll position in the current
    // operation (to be applied when the operation finishes).
    function addToScrollPos(cm, left, top) {
        if (left != null || top != null)
            resolveScrollToPos(cm);
        if (left != null)
            cm.curOp.scrollLeft = (cm.curOp.scrollLeft == null ? cm.doc.scrollLeft : cm.curOp.scrollLeft) + left;
        if (top != null)
            cm.curOp.scrollTop = (cm.curOp.scrollTop == null ? cm.doc.scrollTop : cm.curOp.scrollTop) + top;
    }

    // Make sure that at the end of the operation the current cursor is
    // shown.
    function ensureCursorVisible(cm) {
        resolveScrollToPos(cm);
        var cur = cm.getCursor(), from = cur, to = cur;
        if (!cm.options.lineWrapping) {
            from = cur.ch ? Pos(cur.line, cur.ch - 1) : cur;
            to = Pos(cur.line, cur.ch + 1);
        }
        cm.curOp.scrollToPos = {from: from, to: to, margin: cm.options.cursorScrollMargin, isCursor: true};
    }

    // When an operation has its scrollToPos property set, and another
    // scroll action is applied before the end of the operation, this
    // 'simulates' scrolling that position into view in a cheap way, so
    // that the effect of intermediate scroll commands is not ignored.
    function resolveScrollToPos(cm) {
        var range = cm.curOp.scrollToPos;
        if (range) {
            cm.curOp.scrollToPos = null;
            var from = estimateCoords(cm, range.from), to = estimateCoords(cm, range.to);
            var sPos = calculateScrollPos(cm, Math.min(from.left, to.left),
                    Math.min(from.top, to.top) - range.margin,
                    Math.max(from.right, to.right),
                    Math.max(from.bottom, to.bottom) + range.margin);
            cm.scrollTo(sPos.scrollLeft, sPos.scrollTop);
        }
    }

    // API UTILITIES

    // Indent the given line. The how parameter can be "smart",
    // "add"/null, "subtract", or "prev". When aggressive is false
    // (typically set to true for forced single-line indents), empty
    // lines are not indented, and places where the mode returns Pass
    // are left alone.
    function indentLine(cm, n, how, aggressive) {
        var doc = cm.doc, state;
        if (how == null)
            how = "add";
        if (how == "smart") {
            // Fall back to "prev" when the mode doesn't have an indentation
            // method.
            if (!cm.doc.mode.indent)
                how = "prev";
            else
                state = getStateBefore(cm, n);
        }

        var tabSize = cm.options.tabSize;
        var line = getLine(doc, n), curSpace = countColumn(line.text, null, tabSize);
        if (line.stateAfter)
            line.stateAfter = null;
        var curSpaceString = line.text.match(/^\s*/)[0], indentation;
        if (!aggressive && !/\S/.test(line.text)) {
            indentation = 0;
            how = "not";
        } else if (how == "smart") {
            indentation = cm.doc.mode.indent(state, line.text.slice(curSpaceString.length), line.text);
            if (indentation == Pass) {
                if (!aggressive)
                    return;
                how = "prev";
            }
        }
        if (how == "prev") {
            if (n > doc.first)
                indentation = countColumn(getLine(doc, n - 1).text, null, tabSize);
            else
                indentation = 0;
        } else if (how == "add") {
            indentation = curSpace + cm.options.indentUnit;
        } else if (how == "subtract") {
            indentation = curSpace - cm.options.indentUnit;
        } else if (typeof how == "number") {
            indentation = curSpace + how;
        }
        indentation = Math.max(0, indentation);

        var indentString = "", pos = 0;
        if (cm.options.indentWithTabs)
            for (var i = Math.floor(indentation / tabSize); i; --i) {
                pos += tabSize;
                indentString += "\t";
            }
        if (pos < indentation)
            indentString += spaceStr(indentation - pos);

        if (indentString != curSpaceString) {
            replaceRange(cm.doc, indentString, Pos(n, 0), Pos(n, curSpaceString.length), "+input");
        } else {
            // Ensure that, if the cursor was in the whitespace at the start
            // of the line, it is moved to the end of that space.
            for (var i = 0; i < doc.sel.ranges.length; i++) {
                var range = doc.sel.ranges[i];
                if (range.head.line == n && range.head.ch < curSpaceString.length) {
                    var pos = Pos(n, curSpaceString.length);
                    replaceOneSelection(doc, i, new Range(pos, pos));
                    break;
                }
            }
        }
        line.stateAfter = null;
    }

    // Utility for applying a change to a line by handle or number,
    // returning the number and optionally registering the line as
    // changed.
    function changeLine(cm, handle, changeType, op) {
        var no = handle, line = handle, doc = cm.doc;
        if (typeof handle == "number")
            line = getLine(doc, clipLine(doc, handle));
        else
            no = lineNo(handle);
        if (no == null)
            return null;
        if (op(line, no))
            regLineChange(cm, no, changeType);
        return line;
    }

    // Helper for deleting text near the selection(s), used to implement
    // backspace, delete, and similar functionality.
    function deleteNearSelection(cm, compute) {
        var ranges = cm.doc.sel.ranges, kill = [];
        // Build up a set of ranges to kill first, merging overlapping
        // ranges.
        for (var i = 0; i < ranges.length; i++) {
            var toKill = compute(ranges[i]);
            while (kill.length && cmp(toKill.from, lst(kill).to) <= 0) {
                var replaced = kill.pop();
                if (cmp(replaced.from, toKill.from) < 0) {
                    toKill.from = replaced.from;
                    break;
                }
            }
            kill.push(toKill);
        }
        // Next, remove those actual ranges.
        runInOp(cm, function () {
            for (var i = kill.length - 1; i >= 0; i--)
                replaceRange(cm.doc, "", kill[i].from, kill[i].to, "+delete");
            ensureCursorVisible(cm);
        });
    }

    // Used for horizontal relative motion. Dir is -1 or 1 (left or
    // right), unit can be "char", "column" (like char, but doesn't
    // cross line boundaries), "word" (across next word), or "group" (to
    // the start of next group of word or non-word-non-whitespace
    // chars). The visually param controls whether, in right-to-left
    // text, direction 1 means to move towards the next index in the
    // string, or towards the character to the right of the current
    // position. The resulting position will have a hitSide=true
    // property if it reached the end of the document.
    function findPosH(doc, pos, dir, unit, visually) {
        var line = pos.line, ch = pos.ch, origDir = dir;
        var lineObj = getLine(doc, line);
        var possible = true;
        function findNextLine() {
            var l = line + dir;
            if (l < doc.first || l >= doc.first + doc.size)
                return (possible = false);
            line = l;
            return lineObj = getLine(doc, l);
        }
        function moveOnce(boundToLine) {
            var next = (visually ? moveVisually : moveLogically)(lineObj, ch, dir, true);
            if (next == null) {
                if (!boundToLine && findNextLine()) {
                    if (visually)
                        ch = (dir < 0 ? lineRight : lineLeft)(lineObj);
                    else
                        ch = dir < 0 ? lineObj.text.length : 0;
                } else
                    return (possible = false);
            } else
                ch = next;
            return true;
        }

        if (unit == "char")
            moveOnce();
        else if (unit == "column")
            moveOnce(true);
        else if (unit == "word" || unit == "group") {
            var sawType = null, group = unit == "group";
            for (var first = true; ; first = false) {
                if (dir < 0 && !moveOnce(!first))
                    break;
                var cur = lineObj.text.charAt(ch) || "\n";
                var type = isWordChar(cur) ? "w"
                        : group && cur == "\n" ? "n"
                        : !group || /\s/.test(cur) ? null
                        : "p";
                if (group && !first && !type)
                    type = "s";
                if (sawType && sawType != type) {
                    if (dir < 0) {
                        dir = 1;
                        moveOnce();
                    }
                    break;
                }

                if (type)
                    sawType = type;
                if (dir > 0 && !moveOnce(!first))
                    break;
            }
        }
        var result = skipAtomic(doc, Pos(line, ch), origDir, true);
        if (!possible)
            result.hitSide = true;
        return result;
    }

    // For relative vertical movement. Dir may be -1 or 1. Unit can be
    // "page" or "line". The resulting position will have a hitSide=true
    // property if it reached the end of the document.
    function findPosV(cm, pos, dir, unit) {
        var doc = cm.doc, x = pos.left, y;
        if (unit == "page") {
            var pageSize = Math.min(cm.display.wrapper.clientHeight, window.innerHeight || document.documentElement.clientHeight);
            y = pos.top + dir * (pageSize - (dir < 0 ? 1.5 : .5) * textHeight(cm.display));
        } else if (unit == "line") {
            y = dir > 0 ? pos.bottom + 3 : pos.top - 3;
        }
        for (; ; ) {
            var target = coordsChar(cm, x, y);
            if (!target.outside)
                break;
            if (dir < 0 ? y <= 0 : y >= doc.height) {
                target.hitSide = true;
                break;
            }
            y += dir * 5;
        }
        return target;
    }

    // Find the word at the given position (as returned by coordsChar).
    function findWordAt(doc, pos) {
        var line = getLine(doc, pos.line).text;
        var start = pos.ch, end = pos.ch;
        if (line) {
            if ((pos.xRel < 0 || end == line.length) && start)
                --start;
            else
                ++end;
            var startChar = line.charAt(start);
            var check = isWordChar(startChar) ? isWordChar
                    : /\s/.test(startChar) ? function (ch) {
                return /\s/.test(ch);
            }
            : function (ch) {
                return !/\s/.test(ch) && !isWordChar(ch);
            };
            while (start > 0 && check(line.charAt(start - 1)))
                --start;
            while (end < line.length && check(line.charAt(end)))
                ++end;
        }
        return new Range(Pos(pos.line, start), Pos(pos.line, end));
    }

    // EDITOR METHODS

    // The publicly visible API. Note that methodOp(f) means
    // 'wrap f in an operation, performed on its `this` parameter'.

    // This is not the complete set of editor methods. Most of the
    // methods defined on the Doc type are also injected into
    // CodeMirror.prototype, for backwards compatibility and
    // convenience.

    CodeMirror.prototype = {
        constructor: CodeMirror,
        focus: function () {
            window.focus();
            focusInput(this);
            fastPoll(this);
        },
        setOption: function (option, value) {
            var options = this.options, old = options[option];
            if (options[option] == value && option != "mode")
                return;
            options[option] = value;
            if (optionHandlers.hasOwnProperty(option))
                operation(this, optionHandlers[option])(this, value, old);
        },
        getOption: function (option) {
            return this.options[option];
        },
        getDoc: function () {
            return this.doc;
        },
        addKeyMap: function (map, bottom) {
            this.state.keyMaps[bottom ? "push" : "unshift"](map);
        },
        removeKeyMap: function (map) {
            var maps = this.state.keyMaps;
            for (var i = 0; i < maps.length; ++i)
                if (maps[i] == map || (typeof maps[i] != "string" && maps[i].name == map)) {
                    maps.splice(i, 1);
                    return true;
                }
        },
        addOverlay: methodOp(function (spec, options) {
            var mode = spec.token ? spec : CodeMirror.getMode(this.options, spec);
            if (mode.startState)
                throw new Error("Overlays may not be stateful.");
            this.state.overlays.push({mode: mode, modeSpec: spec, opaque: options && options.opaque});
            this.state.modeGen++;
            regChange(this);
        }),
        removeOverlay: methodOp(function (spec) {
            var overlays = this.state.overlays;
            for (var i = 0; i < overlays.length; ++i) {
                var cur = overlays[i].modeSpec;
                if (cur == spec || typeof spec == "string" && cur.name == spec) {
                    overlays.splice(i, 1);
                    this.state.modeGen++;
                    regChange(this);
                    return;
                }
            }
        }),
        indentLine: methodOp(function (n, dir, aggressive) {
            if (typeof dir != "string" && typeof dir != "number") {
                if (dir == null)
                    dir = this.options.smartIndent ? "smart" : "prev";
                else
                    dir = dir ? "add" : "subtract";
            }
            if (isLine(this.doc, n))
                indentLine(this, n, dir, aggressive);
        }),
        indentSelection: methodOp(function (how) {
            var ranges = this.doc.sel.ranges, end = -1;
            for (var i = 0; i < ranges.length; i++) {
                var range = ranges[i];
                if (!range.empty()) {
                    var start = Math.max(end, range.from().line);
                    var to = range.to();
                    end = Math.min(this.lastLine(), to.line - (to.ch ? 0 : 1)) + 1;
                    for (var j = start; j < end; ++j)
                        indentLine(this, j, how);
                } else if (range.head.line > end) {
                    indentLine(this, range.head.line, how, true);
                    end = range.head.line;
                    if (i == this.doc.sel.primIndex)
                        ensureCursorVisible(this);
                }
            }
        }),
        // Fetch the parser token for a given character. Useful for hacks
        // that want to inspect the mode state (say, for completion).
        getTokenAt: function (pos, precise) {
            var doc = this.doc;
            pos = clipPos(doc, pos);
            var state = getStateBefore(this, pos.line, precise), mode = this.doc.mode;
            var line = getLine(doc, pos.line);
            var stream = new StringStream(line.text, this.options.tabSize);
            while (stream.pos < pos.ch && !stream.eol()) {
                stream.start = stream.pos;
                var style = readToken(mode, stream, state);
            }
            return {start: stream.start,
                end: stream.pos,
                string: stream.current(),
                type: style || null,
                state: state};
        },
        getTokenTypeAt: function (pos) {
            pos = clipPos(this.doc, pos);
            var styles = getLineStyles(this, getLine(this.doc, pos.line));
            var before = 0, after = (styles.length - 1) / 2, ch = pos.ch;
            var type;
            if (ch == 0)
                type = styles[2];
            else
                for (; ; ) {
                    var mid = (before + after) >> 1;
                    if ((mid ? styles[mid * 2 - 1] : 0) >= ch)
                        after = mid;
                    else if (styles[mid * 2 + 1] < ch)
                        before = mid + 1;
                    else {
                        type = styles[mid * 2 + 2];
                        break;
                    }
                }
            var cut = type ? type.indexOf("cm-overlay ") : -1;
            return cut < 0 ? type : cut == 0 ? null : type.slice(0, cut - 1);
        },
        getModeAt: function (pos) {
            var mode = this.doc.mode;
            if (!mode.innerMode)
                return mode;
            return CodeMirror.innerMode(mode, this.getTokenAt(pos).state).mode;
        },
        getHelper: function (pos, type) {
            return this.getHelpers(pos, type)[0];
        },
        getHelpers: function (pos, type) {
            var found = [];
            if (!helpers.hasOwnProperty(type))
                return helpers;
            var help = helpers[type], mode = this.getModeAt(pos);
            if (typeof mode[type] == "string") {
                if (help[mode[type]])
                    found.push(help[mode[type]]);
            } else if (mode[type]) {
                for (var i = 0; i < mode[type].length; i++) {
                    var val = help[mode[type][i]];
                    if (val)
                        found.push(val);
                }
            } else if (mode.helperType && help[mode.helperType]) {
                found.push(help[mode.helperType]);
            } else if (help[mode.name]) {
                found.push(help[mode.name]);
            }
            for (var i = 0; i < help._global.length; i++) {
                var cur = help._global[i];
                if (cur.pred(mode, this) && indexOf(found, cur.val) == -1)
                    found.push(cur.val);
            }
            return found;
        },
        getStateAfter: function (line, precise) {
            var doc = this.doc;
            line = clipLine(doc, line == null ? doc.first + doc.size - 1 : line);
            return getStateBefore(this, line + 1, precise);
        },
        cursorCoords: function (start, mode) {
            var pos, range = this.doc.sel.primary();
            if (start == null)
                pos = range.head;
            else if (typeof start == "object")
                pos = clipPos(this.doc, start);
            else
                pos = start ? range.from() : range.to();
            return cursorCoords(this, pos, mode || "page");
        },
        charCoords: function (pos, mode) {
            return charCoords(this, clipPos(this.doc, pos), mode || "page");
        },
        coordsChar: function (coords, mode) {
            coords = fromCoordSystem(this, coords, mode || "page");
            return coordsChar(this, coords.left, coords.top);
        },
        lineAtHeight: function (height, mode) {
            height = fromCoordSystem(this, {top: height, left: 0}, mode || "page").top;
            return lineAtHeight(this.doc, height + this.display.viewOffset);
        },
        heightAtLine: function (line, mode) {
            var end = false, last = this.doc.first + this.doc.size - 1;
            if (line < this.doc.first)
                line = this.doc.first;
            else if (line > last) {
                line = last;
                end = true;
            }
            var lineObj = getLine(this.doc, line);
            return intoCoordSystem(this, lineObj, {top: 0, left: 0}, mode || "page").top +
                    (end ? this.doc.height - heightAtLine(lineObj) : 0);
        },
        defaultTextHeight: function () {
            return textHeight(this.display);
        },
        defaultCharWidth: function () {
            return charWidth(this.display);
        },
        setGutterMarker: methodOp(function (line, gutterID, value) {
            return changeLine(this, line, "gutter", function (line) {
                var markers = line.gutterMarkers || (line.gutterMarkers = {});
                markers[gutterID] = value;
                if (!value && isEmpty(markers))
                    line.gutterMarkers = null;
                return true;
            });
        }),
        clearGutter: methodOp(function (gutterID) {
            var cm = this, doc = cm.doc, i = doc.first;
            doc.iter(function (line) {
                if (line.gutterMarkers && line.gutterMarkers[gutterID]) {
                    line.gutterMarkers[gutterID] = null;
                    regLineChange(cm, i, "gutter");
                    if (isEmpty(line.gutterMarkers))
                        line.gutterMarkers = null;
                }
                ++i;
            });
        }),
        addLineClass: methodOp(function (handle, where, cls) {
            return changeLine(this, handle, "class", function (line) {
                var prop = where == "text" ? "textClass" : where == "background" ? "bgClass" : "wrapClass";
                if (!line[prop])
                    line[prop] = cls;
                else if (new RegExp("(?:^|\\s)" + cls + "(?:$|\\s)").test(line[prop]))
                    return false;
                else
                    line[prop] += " " + cls;
                return true;
            });
        }),
        removeLineClass: methodOp(function (handle, where, cls) {
            return changeLine(this, handle, "class", function (line) {
                var prop = where == "text" ? "textClass" : where == "background" ? "bgClass" : "wrapClass";
                var cur = line[prop];
                if (!cur)
                    return false;
                else if (cls == null)
                    line[prop] = null;
                else {
                    var found = cur.match(new RegExp("(?:^|\\s+)" + cls + "(?:$|\\s+)"));
                    if (!found)
                        return false;
                    var end = found.index + found[0].length;
                    line[prop] = cur.slice(0, found.index) + (!found.index || end == cur.length ? "" : " ") + cur.slice(end) || null;
                }
                return true;
            });
        }),
        addLineWidget: methodOp(function (handle, node, options) {
            return addLineWidget(this, handle, node, options);
        }),
        removeLineWidget: function (widget) {
            widget.clear();
        },
        lineInfo: function (line) {
            if (typeof line == "number") {
                if (!isLine(this.doc, line))
                    return null;
                var n = line;
                line = getLine(this.doc, line);
                if (!line)
                    return null;
            } else {
                var n = lineNo(line);
                if (n == null)
                    return null;
            }
            return {line: n, handle: line, text: line.text, gutterMarkers: line.gutterMarkers,
                textClass: line.textClass, bgClass: line.bgClass, wrapClass: line.wrapClass,
                widgets: line.widgets};
        },
        getViewport: function () {
            return {from: this.display.viewFrom, to: this.display.viewTo};
        },
        addWidget: function (pos, node, scroll, vert, horiz) {
            var display = this.display;
            pos = cursorCoords(this, clipPos(this.doc, pos));
            var top = pos.bottom, left = pos.left;
            node.style.position = "absolute";
            display.sizer.appendChild(node);
            if (vert == "over") {
                top = pos.top;
            } else if (vert == "above" || vert == "near") {
                var vspace = Math.max(display.wrapper.clientHeight, this.doc.height),
                        hspace = Math.max(display.sizer.clientWidth, display.lineSpace.clientWidth);
                // Default to positioning above (if specified and possible); otherwise default to positioning below
                if ((vert == 'above' || pos.bottom + node.offsetHeight > vspace) && pos.top > node.offsetHeight)
                    top = pos.top - node.offsetHeight;
                else if (pos.bottom + node.offsetHeight <= vspace)
                    top = pos.bottom;
                if (left + node.offsetWidth > hspace)
                    left = hspace - node.offsetWidth;
            }
            node.style.top = top + "px";
            node.style.left = node.style.right = "";
            if (horiz == "right") {
                left = display.sizer.clientWidth - node.offsetWidth;
                node.style.right = "0px";
            } else {
                if (horiz == "left")
                    left = 0;
                else if (horiz == "middle")
                    left = (display.sizer.clientWidth - node.offsetWidth) / 2;
                node.style.left = left + "px";
            }
            if (scroll)
                scrollIntoView(this, left, top, left + node.offsetWidth, top + node.offsetHeight);
        },
        triggerOnKeyDown: methodOp(onKeyDown),
        triggerOnKeyPress: methodOp(onKeyPress),
        triggerOnKeyUp: methodOp(onKeyUp),
        execCommand: function (cmd) {
            if (commands.hasOwnProperty(cmd))
                return commands[cmd](this);
        },
        findPosH: function (from, amount, unit, visually) {
            var dir = 1;
            if (amount < 0) {
                dir = -1;
                amount = -amount;
            }
            for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
                cur = findPosH(this.doc, cur, dir, unit, visually);
                if (cur.hitSide)
                    break;
            }
            return cur;
        },
        moveH: methodOp(function (dir, unit) {
            var cm = this;
            cm.extendSelectionsBy(function (range) {
                if (cm.display.shift || cm.doc.extend || range.empty())
                    return findPosH(cm.doc, range.head, dir, unit, cm.options.rtlMoveVisually);
                else
                    return dir < 0 ? range.from() : range.to();
            }, sel_move);
        }),
        deleteH: methodOp(function (dir, unit) {
            var sel = this.doc.sel, doc = this.doc;
            if (sel.somethingSelected())
                doc.replaceSelection("", null, "+delete");
            else
                deleteNearSelection(this, function (range) {
                    var other = findPosH(doc, range.head, dir, unit, false);
                    return dir < 0 ? {from: other, to: range.head} : {from: range.head, to: other};
                });
        }),
        findPosV: function (from, amount, unit, goalColumn) {
            var dir = 1, x = goalColumn;
            if (amount < 0) {
                dir = -1;
                amount = -amount;
            }
            for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
                var coords = cursorCoords(this, cur, "div");
                if (x == null)
                    x = coords.left;
                else
                    coords.left = x;
                cur = findPosV(this, coords, dir, unit);
                if (cur.hitSide)
                    break;
            }
            return cur;
        },
        moveV: methodOp(function (dir, unit) {
            var cm = this, doc = this.doc, goals = [];
            var collapse = !cm.display.shift && !doc.extend && doc.sel.somethingSelected();
            doc.extendSelectionsBy(function (range) {
                if (collapse)
                    return dir < 0 ? range.from() : range.to();
                var headPos = cursorCoords(cm, range.head, "div");
                if (range.goalColumn != null)
                    headPos.left = range.goalColumn;
                goals.push(headPos.left);
                var pos = findPosV(cm, headPos, dir, unit);
                if (unit == "page" && range == doc.sel.primary())
                    addToScrollPos(cm, null, charCoords(cm, pos, "div").top - headPos.top);
                return pos;
            }, sel_move);
            if (goals.length)
                for (var i = 0; i < doc.sel.ranges.length; i++)
                    doc.sel.ranges[i].goalColumn = goals[i];
        }),
        toggleOverwrite: function (value) {
            if (value != null && value == this.state.overwrite)
                return;
            if (this.state.overwrite = !this.state.overwrite)
                addClass(this.display.cursorDiv, "CodeMirror-overwrite");
            else
                rmClass(this.display.cursorDiv, "CodeMirror-overwrite");

            signal(this, "overwriteToggle", this, this.state.overwrite);
        },
        hasFocus: function () {
            return activeElt() == this.display.input;
        },
        scrollTo: methodOp(function (x, y) {
            if (x != null || y != null)
                resolveScrollToPos(this);
            if (x != null)
                this.curOp.scrollLeft = x;
            if (y != null)
                this.curOp.scrollTop = y;
        }),
        getScrollInfo: function () {
            var scroller = this.display.scroller, co = scrollerCutOff;
            return {left: scroller.scrollLeft, top: scroller.scrollTop,
                height: scroller.scrollHeight - co, width: scroller.scrollWidth - co,
                clientHeight: scroller.clientHeight - co, clientWidth: scroller.clientWidth - co};
        },
        scrollIntoView: methodOp(function (range, margin) {
            if (range == null) {
                range = {from: this.doc.sel.primary().head, to: null};
                if (margin == null)
                    margin = this.options.cursorScrollMargin;
            } else if (typeof range == "number") {
                range = {from: Pos(range, 0), to: null};
            } else if (range.from == null) {
                range = {from: range, to: null};
            }
            if (!range.to)
                range.to = range.from;
            range.margin = margin || 0;

            if (range.from.line != null) {
                resolveScrollToPos(this);
                this.curOp.scrollToPos = range;
            } else {
                var sPos = calculateScrollPos(this, Math.min(range.from.left, range.to.left),
                        Math.min(range.from.top, range.to.top) - range.margin,
                        Math.max(range.from.right, range.to.right),
                        Math.max(range.from.bottom, range.to.bottom) + range.margin);
                this.scrollTo(sPos.scrollLeft, sPos.scrollTop);
            }
        }),
        setSize: methodOp(function (width, height) {
            function interpret(val) {
                return typeof val == "number" || /^\d+$/.test(String(val)) ? val + "px" : val;
            }
            if (width != null)
                this.display.wrapper.style.width = interpret(width);
            if (height != null)
                this.display.wrapper.style.height = interpret(height);
            if (this.options.lineWrapping)
                clearLineMeasurementCache(this);
            this.curOp.forceUpdate = true;
            signal(this, "refresh", this);
        }),
        operation: function (f) {
            return runInOp(this, f);
        },
        refresh: methodOp(function () {
            var oldHeight = this.display.cachedTextHeight;
            regChange(this);
            this.curOp.forceUpdate = true;
            clearCaches(this);
            this.scrollTo(this.doc.scrollLeft, this.doc.scrollTop);
            updateGutterSpace(this);
            if (oldHeight == null || Math.abs(oldHeight - textHeight(this.display)) > .5)
                estimateLineHeights(this);
            signal(this, "refresh", this);
        }),
        swapDoc: methodOp(function (doc) {
            var old = this.doc;
            old.cm = null;
            attachDoc(this, doc);
            clearCaches(this);
            resetInput(this);
            this.scrollTo(doc.scrollLeft, doc.scrollTop);
            signalLater(this, "swapDoc", this, old);
            return old;
        }),
        getInputField: function () {
            return this.display.input;
        },
        getWrapperElement: function () {
            return this.display.wrapper;
        },
        getScrollerElement: function () {
            return this.display.scroller;
        },
        getGutterElement: function () {
            return this.display.gutters;
        }
    };
    eventMixin(CodeMirror);

    // OPTION DEFAULTS

    // The default configuration options.
    var defaults = CodeMirror.defaults = {};
    // Functions to run when options are changed.
    var optionHandlers = CodeMirror.optionHandlers = {};

    function option(name, deflt, handle, notOnInit) {
        CodeMirror.defaults[name] = deflt;
        if (handle)
            optionHandlers[name] =
                    notOnInit ? function (cm, val, old) {
                        if (old != Init)
                            handle(cm, val, old);
                    } : handle;
    }

    // Passed to option handlers when there is no old value.
    var Init = CodeMirror.Init = {toString: function () {
            return "CodeMirror.Init";
        }};

    // These two are, on init, called from the constructor because they
    // have to be initialized before the editor can start at all.
    option("value", "", function (cm, val) {
        cm.setValue(val);
    }, true);
    option("mode", null, function (cm, val) {
        cm.doc.modeOption = val;
        loadMode(cm);
    }, true);

    option("indentUnit", 2, loadMode, true);
    option("indentWithTabs", false);
    option("smartIndent", true);
    option("tabSize", 4, function (cm) {
        resetModeState(cm);
        clearCaches(cm);
        regChange(cm);
    }, true);
    option("specialChars", /[\t\u0000-\u0019\u00ad\u200b\u2028\u2029\ufeff]/g, function (cm, val) {
        cm.options.specialChars = new RegExp(val.source + (val.test("\t") ? "" : "|\t"), "g");
        cm.refresh();
    }, true);
    option("specialCharPlaceholder", defaultSpecialCharPlaceholder, function (cm) {
        cm.refresh();
    }, true);
    option("electricChars", true);
    option("rtlMoveVisually", !windows);
    option("wholeLineUpdateBefore", true);

    option("theme", "default", function (cm) {
        themeChanged(cm);
        guttersChanged(cm);
    }, true);
    option("keyMap", "default", keyMapChanged);
    option("extraKeys", null);

    option("lineWrapping", false, wrappingChanged, true);
    option("gutters", [], function (cm) {
        setGuttersForLineNumbers(cm.options);
        guttersChanged(cm);
    }, true);
    option("fixedGutter", true, function (cm, val) {
        cm.display.gutters.style.left = val ? compensateForHScroll(cm.display) + "px" : "0";
        cm.refresh();
    }, true);
    option("coverGutterNextToScrollbar", false, updateScrollbars, true);
    option("lineNumbers", false, function (cm) {
        setGuttersForLineNumbers(cm.options);
        guttersChanged(cm);
    }, true);
    option("firstLineNumber", 1, guttersChanged, true);
    option("lineNumberFormatter", function (integer) {
        return integer;
    }, guttersChanged, true);
    option("showCursorWhenSelecting", false, updateSelection, true);

    option("resetSelectionOnContextMenu", true);

    option("readOnly", false, function (cm, val) {
        if (val == "nocursor") {
            onBlur(cm);
            cm.display.input.blur();
            cm.display.disabled = true;
        } else {
            cm.display.disabled = false;
            if (!val)
                resetInput(cm);
        }
    });
    option("disableInput", false, function (cm, val) {
        if (!val)
            resetInput(cm);
    }, true);
    option("dragDrop", true);

    option("cursorBlinkRate", 530);
    option("cursorScrollMargin", 0);
    option("cursorHeight", 1);
    option("workTime", 100);
    option("workDelay", 100);
    option("flattenSpans", true, resetModeState, true);
    option("addModeClass", false, resetModeState, true);
    option("pollInterval", 100);
    option("undoDepth", 200, function (cm, val) {
        cm.doc.history.undoDepth = val;
    });
    option("historyEventDelay", 1250);
    option("viewportMargin", 10, function (cm) {
        cm.refresh();
    }, true);
    option("maxHighlightLength", 10000, resetModeState, true);
    option("moveInputWithCursor", true, function (cm, val) {
        if (!val)
            cm.display.inputDiv.style.top = cm.display.inputDiv.style.left = 0;
    });

    option("tabindex", null, function (cm, val) {
        cm.display.input.tabIndex = val || "";
    });
    option("autofocus", null);

    // MODE DEFINITION AND QUERYING

    // Known modes, by name and by MIME
    var modes = CodeMirror.modes = {}, mimeModes = CodeMirror.mimeModes = {};

    // Extra arguments are stored as the mode's dependencies, which is
    // used by (legacy) mechanisms like loadmode.js to automatically
    // load a mode. (Preferred mechanism is the require/define calls.)
    CodeMirror.defineMode = function (name, mode) {
        if (!CodeMirror.defaults.mode && name != "null")
            CodeMirror.defaults.mode = name;
        if (arguments.length > 2) {
            mode.dependencies = [];
            for (var i = 2; i < arguments.length; ++i)
                mode.dependencies.push(arguments[i]);
        }
        modes[name] = mode;
    };

    CodeMirror.defineMIME = function (mime, spec) {
        mimeModes[mime] = spec;
    };

    // Given a MIME type, a {name, ...options} config object, or a name
    // string, return a mode config object.
    CodeMirror.resolveMode = function (spec) {
        if (typeof spec == "string" && mimeModes.hasOwnProperty(spec)) {
            spec = mimeModes[spec];
        } else if (spec && typeof spec.name == "string" && mimeModes.hasOwnProperty(spec.name)) {
            var found = mimeModes[spec.name];
            if (typeof found == "string")
                found = {name: found};
            spec = createObj(found, spec);
            spec.name = found.name;
        } else if (typeof spec == "string" && /^[\w\-]+\/[\w\-]+\+xml$/.test(spec)) {
            return CodeMirror.resolveMode("application/xml");
        }
        if (typeof spec == "string")
            return {name: spec};
        else
            return spec || {name: "null"};
    };

    // Given a mode spec (anything that resolveMode accepts), find and
    // initialize an actual mode object.
    CodeMirror.getMode = function (options, spec) {
        var spec = CodeMirror.resolveMode(spec);
        var mfactory = modes[spec.name];
        if (!mfactory)
            return CodeMirror.getMode(options, "text/plain");
        var modeObj = mfactory(options, spec);
        if (modeExtensions.hasOwnProperty(spec.name)) {
            var exts = modeExtensions[spec.name];
            for (var prop in exts) {
                if (!exts.hasOwnProperty(prop))
                    continue;
                if (modeObj.hasOwnProperty(prop))
                    modeObj["_" + prop] = modeObj[prop];
                modeObj[prop] = exts[prop];
            }
        }
        modeObj.name = spec.name;
        if (spec.helperType)
            modeObj.helperType = spec.helperType;
        if (spec.modeProps)
            for (var prop in spec.modeProps)
                modeObj[prop] = spec.modeProps[prop];

        return modeObj;
    };

    // Minimal default mode.
    CodeMirror.defineMode("null", function () {
        return {token: function (stream) {
                stream.skipToEnd();
            }};
    });
    CodeMirror.defineMIME("text/plain", "null");

    // This can be used to attach properties to mode objects from
    // outside the actual mode definition.
    var modeExtensions = CodeMirror.modeExtensions = {};
    CodeMirror.extendMode = function (mode, properties) {
        var exts = modeExtensions.hasOwnProperty(mode) ? modeExtensions[mode] : (modeExtensions[mode] = {});
        copyObj(properties, exts);
    };

    // EXTENSIONS

    CodeMirror.defineExtension = function (name, func) {
        CodeMirror.prototype[name] = func;
    };
    CodeMirror.defineDocExtension = function (name, func) {
        Doc.prototype[name] = func;
    };
    CodeMirror.defineOption = option;

    var initHooks = [];
    CodeMirror.defineInitHook = function (f) {
        initHooks.push(f);
    };

    var helpers = CodeMirror.helpers = {};
    CodeMirror.registerHelper = function (type, name, value) {
        if (!helpers.hasOwnProperty(type))
            helpers[type] = CodeMirror[type] = {_global: []};
        helpers[type][name] = value;
    };
    CodeMirror.registerGlobalHelper = function (type, name, predicate, value) {
        CodeMirror.registerHelper(type, name, value);
        helpers[type]._global.push({pred: predicate, val: value});
    };

    // MODE STATE HANDLING

    // Utility functions for working with state. Exported because nested
    // modes need to do this for their inner modes.

    var copyState = CodeMirror.copyState = function (mode, state) {
        if (state === true)
            return state;
        if (mode.copyState)
            return mode.copyState(state);
        var nstate = {};
        for (var n in state) {
            var val = state[n];
            if (val instanceof Array)
                val = val.concat([]);
            nstate[n] = val;
        }
        return nstate;
    };

    var startState = CodeMirror.startState = function (mode, a1, a2) {
        return mode.startState ? mode.startState(a1, a2) : true;
    };

    // Given a mode and a state (for that mode), find the inner mode and
    // state at the position that the state refers to.
    CodeMirror.innerMode = function (mode, state) {
        while (mode.innerMode) {
            var info = mode.innerMode(state);
            if (!info || info.mode == mode)
                break;
            state = info.state;
            mode = info.mode;
        }
        return info || {mode: mode, state: state};
    };

    // STANDARD COMMANDS

    // Commands are parameter-less actions that can be performed on an
    // editor, mostly used for keybindings.
    var commands = CodeMirror.commands = {
        selectAll: function (cm) {
            cm.setSelection(Pos(cm.firstLine(), 0), Pos(cm.lastLine()), sel_dontScroll);
        },
        singleSelection: function (cm) {
            cm.setSelection(cm.getCursor("anchor"), cm.getCursor("head"), sel_dontScroll);
        },
        killLine: function (cm) {
            deleteNearSelection(cm, function (range) {
                if (range.empty()) {
                    var len = getLine(cm.doc, range.head.line).text.length;
                    if (range.head.ch == len && range.head.line < cm.lastLine())
                        return {from: range.head, to: Pos(range.head.line + 1, 0)};
                    else
                        return {from: range.head, to: Pos(range.head.line, len)};
                } else {
                    return {from: range.from(), to: range.to()};
                }
            });
        },
        deleteLine: function (cm) {
            deleteNearSelection(cm, function (range) {
                return {from: Pos(range.from().line, 0),
                    to: clipPos(cm.doc, Pos(range.to().line + 1, 0))};
            });
        },
        delLineLeft: function (cm) {
            deleteNearSelection(cm, function (range) {
                return {from: Pos(range.from().line, 0), to: range.from()};
            });
        },
        undo: function (cm) {
            cm.undo();
        },
        redo: function (cm) {
            cm.redo();
        },
        undoSelection: function (cm) {
            cm.undoSelection();
        },
        redoSelection: function (cm) {
            cm.redoSelection();
        },
        goDocStart: function (cm) {
            cm.extendSelection(Pos(cm.firstLine(), 0));
        },
        goDocEnd: function (cm) {
            cm.extendSelection(Pos(cm.lastLine()));
        },
        goLineStart: function (cm) {
            cm.extendSelectionsBy(function (range) {
                return lineStart(cm, range.head.line);
            }, sel_move);
        },
        goLineStartSmart: function (cm) {
            cm.extendSelectionsBy(function (range) {
                var start = lineStart(cm, range.head.line);
                var line = cm.getLineHandle(start.line);
                var order = getOrder(line);
                if (!order || order[0].level == 0) {
                    var firstNonWS = Math.max(0, line.text.search(/\S/));
                    var inWS = range.head.line == start.line && range.head.ch <= firstNonWS && range.head.ch;
                    return Pos(start.line, inWS ? 0 : firstNonWS);
                }
                return start;
            }, sel_move);
        },
        goLineEnd: function (cm) {
            cm.extendSelectionsBy(function (range) {
                return lineEnd(cm, range.head.line);
            }, sel_move);
        },
        goLineRight: function (cm) {
            cm.extendSelectionsBy(function (range) {
                var top = cm.charCoords(range.head, "div").top + 5;
                return cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div");
            }, sel_move);
        },
        goLineLeft: function (cm) {
            cm.extendSelectionsBy(function (range) {
                var top = cm.charCoords(range.head, "div").top + 5;
                return cm.coordsChar({left: 0, top: top}, "div");
            }, sel_move);
        },
        goLineUp: function (cm) {
            cm.moveV(-1, "line");
        },
        goLineDown: function (cm) {
            cm.moveV(1, "line");
        },
        goPageUp: function (cm) {
            cm.moveV(-1, "page");
        },
        goPageDown: function (cm) {
            cm.moveV(1, "page");
        },
        goCharLeft: function (cm) {
            cm.moveH(-1, "char");
        },
        goCharRight: function (cm) {
            cm.moveH(1, "char");
        },
        goColumnLeft: function (cm) {
            cm.moveH(-1, "column");
        },
        goColumnRight: function (cm) {
            cm.moveH(1, "column");
        },
        goWordLeft: function (cm) {
            cm.moveH(-1, "word");
        },
        goGroupRight: function (cm) {
            cm.moveH(1, "group");
        },
        goGroupLeft: function (cm) {
            cm.moveH(-1, "group");
        },
        goWordRight: function (cm) {
            cm.moveH(1, "word");
        },
        delCharBefore: function (cm) {
            cm.deleteH(-1, "char");
        },
        delCharAfter: function (cm) {
            cm.deleteH(1, "char");
        },
        delWordBefore: function (cm) {
            cm.deleteH(-1, "word");
        },
        delWordAfter: function (cm) {
            cm.deleteH(1, "word");
        },
        delGroupBefore: function (cm) {
            cm.deleteH(-1, "group");
        },
        delGroupAfter: function (cm) {
            cm.deleteH(1, "group");
        },
        indentAuto: function (cm) {
            cm.indentSelection("smart");
        },
        indentMore: function (cm) {
            cm.indentSelection("add");
        },
        indentLess: function (cm) {
            cm.indentSelection("subtract");
        },
        insertTab: function (cm) {
            cm.replaceSelection("\t");
        },
        insertSoftTab: function (cm) {
            var spaces = [], ranges = cm.listSelections(), tabSize = cm.options.tabSize;
            for (var i = 0; i < ranges.length; i++) {
                var pos = ranges[i].from();
                var col = countColumn(cm.getLine(pos.line), pos.ch, tabSize);
                spaces.push(new Array(tabSize - col % tabSize + 1).join(" "));
            }
            cm.replaceSelections(spaces);
        },
        defaultTab: function (cm) {
            if (cm.somethingSelected())
                cm.indentSelection("add");
            else
                cm.execCommand("insertTab");
        },
        transposeChars: function (cm) {
            runInOp(cm, function () {
                var ranges = cm.listSelections();
                for (var i = 0; i < ranges.length; i++) {
                    var cur = ranges[i].head, line = getLine(cm.doc, cur.line).text;
                    if (cur.ch > 0 && cur.ch < line.length - 1)
                        cm.replaceRange(line.charAt(cur.ch) + line.charAt(cur.ch - 1),
                                Pos(cur.line, cur.ch - 1), Pos(cur.line, cur.ch + 1));
                }
            });
        },
        newlineAndIndent: function (cm) {
            runInOp(cm, function () {
                var len = cm.listSelections().length;
                for (var i = 0; i < len; i++) {
                    var range = cm.listSelections()[i];
                    cm.replaceRange("\n", range.anchor, range.head, "+input");
                    cm.indentLine(range.from().line + 1, null, true);
                    ensureCursorVisible(cm);
                }
            });
        },
        toggleOverwrite: function (cm) {
            cm.toggleOverwrite();
        }
    };

    // STANDARD KEYMAPS

    var keyMap = CodeMirror.keyMap = {};
    keyMap.basic = {
        "Left": "goCharLeft", "Right": "goCharRight", "Up": "goLineUp", "Down": "goLineDown",
        "End": "goLineEnd", "Home": "goLineStartSmart", "PageUp": "goPageUp", "PageDown": "goPageDown",
        "Delete": "delCharAfter", "Backspace": "delCharBefore", "Shift-Backspace": "delCharBefore",
        "Tab": "defaultTab", "Shift-Tab": "indentAuto",
        "Enter": "newlineAndIndent", "Insert": "toggleOverwrite",
        "Esc": "singleSelection"
    };
    // Note that the save and find-related commands aren't defined by
    // default. User code or addons can define them. Unknown commands
    // are simply ignored.
    keyMap.pcDefault = {
        "Ctrl-A": "selectAll", "Ctrl-D": "deleteLine", "Ctrl-Z": "undo", "Shift-Ctrl-Z": "redo", "Ctrl-Y": "redo",
        "Ctrl-Home": "goDocStart", "Ctrl-Up": "goDocStart", "Ctrl-End": "goDocEnd", "Ctrl-Down": "goDocEnd",
        "Ctrl-Left": "goGroupLeft", "Ctrl-Right": "goGroupRight", "Alt-Left": "goLineStart", "Alt-Right": "goLineEnd",
        "Ctrl-Backspace": "delGroupBefore", "Ctrl-Delete": "delGroupAfter", "Ctrl-S": "save", "Ctrl-F": "find",
        "Ctrl-G": "findNext", "Shift-Ctrl-G": "findPrev", "Shift-Ctrl-F": "replace", "Shift-Ctrl-R": "replaceAll",
        "Ctrl-[": "indentLess", "Ctrl-]": "indentMore",
        "Ctrl-U": "undoSelection", "Shift-Ctrl-U": "redoSelection", "Alt-U": "redoSelection",
        fallthrough: "basic"
    };
    keyMap.macDefault = {
        "Cmd-A": "selectAll", "Cmd-D": "deleteLine", "Cmd-Z": "undo", "Shift-Cmd-Z": "redo", "Cmd-Y": "redo",
        "Cmd-Up": "goDocStart", "Cmd-End": "goDocEnd", "Cmd-Down": "goDocEnd", "Alt-Left": "goGroupLeft",
        "Alt-Right": "goGroupRight", "Cmd-Left": "goLineStart", "Cmd-Right": "goLineEnd", "Alt-Backspace": "delGroupBefore",
        "Ctrl-Alt-Backspace": "delGroupAfter", "Alt-Delete": "delGroupAfter", "Cmd-S": "save", "Cmd-F": "find",
        "Cmd-G": "findNext", "Shift-Cmd-G": "findPrev", "Cmd-Alt-F": "replace", "Shift-Cmd-Alt-F": "replaceAll",
        "Cmd-[": "indentLess", "Cmd-]": "indentMore", "Cmd-Backspace": "delLineLeft",
        "Cmd-U": "undoSelection", "Shift-Cmd-U": "redoSelection",
        fallthrough: ["basic", "emacsy"]
    };
    // Very basic readline/emacs-style bindings, which are standard on Mac.
    keyMap.emacsy = {
        "Ctrl-F": "goCharRight", "Ctrl-B": "goCharLeft", "Ctrl-P": "goLineUp", "Ctrl-N": "goLineDown",
        "Alt-F": "goWordRight", "Alt-B": "goWordLeft", "Ctrl-A": "goLineStart", "Ctrl-E": "goLineEnd",
        "Ctrl-V": "goPageDown", "Shift-Ctrl-V": "goPageUp", "Ctrl-D": "delCharAfter", "Ctrl-H": "delCharBefore",
        "Alt-D": "delWordAfter", "Alt-Backspace": "delWordBefore", "Ctrl-K": "killLine", "Ctrl-T": "transposeChars"
    };
    keyMap["default"] = mac ? keyMap.macDefault : keyMap.pcDefault;

    // KEYMAP DISPATCH

    function getKeyMap(val) {
        if (typeof val == "string")
            return keyMap[val];
        else
            return val;
    }

    // Given an array of keymaps and a key name, call handle on any
    // bindings found, until that returns a truthy value, at which point
    // we consider the key handled. Implements things like binding a key
    // to false stopping further handling and keymap fallthrough.
    var lookupKey = CodeMirror.lookupKey = function (name, maps, handle) {
        function lookup(map) {
            map = getKeyMap(map);
            var found = map[name];
            if (found === false)
                return "stop";
            if (found != null && handle(found))
                return true;
            if (map.nofallthrough)
                return "stop";

            var fallthrough = map.fallthrough;
            if (fallthrough == null)
                return false;
            if (Object.prototype.toString.call(fallthrough) != "[object Array]")
                return lookup(fallthrough);
            for (var i = 0; i < fallthrough.length; ++i) {
                var done = lookup(fallthrough[i]);
                if (done)
                    return done;
            }
            return false;
        }

        for (var i = 0; i < maps.length; ++i) {
            var done = lookup(maps[i]);
            if (done)
                return done != "stop";
        }
    };

    // Modifier key presses don't count as 'real' key presses for the
    // purpose of keymap fallthrough.
    var isModifierKey = CodeMirror.isModifierKey = function (event) {
        var name = keyNames[event.keyCode];
        return name == "Ctrl" || name == "Alt" || name == "Shift" || name == "Mod";
    };

    // Look up the name of a key as indicated by an event object.
    var keyName = CodeMirror.keyName = function (event, noShift) {
        if (presto && event.keyCode == 34 && event["char"])
            return false;
        var name = keyNames[event.keyCode];
        if (name == null || event.altGraphKey)
            return false;
        if (event.altKey)
            name = "Alt-" + name;
        if (flipCtrlCmd ? event.metaKey : event.ctrlKey)
            name = "Ctrl-" + name;
        if (flipCtrlCmd ? event.ctrlKey : event.metaKey)
            name = "Cmd-" + name;
        if (!noShift && event.shiftKey)
            name = "Shift-" + name;
        return name;
    };

    // FROMTEXTAREA

    CodeMirror.fromTextArea = function (textarea, options) {
        if (!options)
            options = {};
        options.value = textarea.value;
        if (!options.tabindex && textarea.tabindex)
            options.tabindex = textarea.tabindex;
        if (!options.placeholder && textarea.placeholder)
            options.placeholder = textarea.placeholder;
        // Set autofocus to true if this textarea is focused, or if it has
        // autofocus and no other element is focused.
        if (options.autofocus == null) {
            var hasFocus = activeElt();
            options.autofocus = hasFocus == textarea ||
                    textarea.getAttribute("autofocus") != null && hasFocus == document.body;
        }

        function save() {
            textarea.value = cm.getValue();
        }
        if (textarea.form) {
            on(textarea.form, "submit", save);
            // Deplorable hack to make the submit method do the right thing.
            if (!options.leaveSubmitMethodAlone) {
                var form = textarea.form, realSubmit = form.submit;
                try {
                    var wrappedSubmit = form.submit = function () {
                        save();
                        form.submit = realSubmit;
                        form.submit();
                        form.submit = wrappedSubmit;
                    };
                } catch (e) {
                }
            }
        }

        textarea.style.display = "none";
        var cm = CodeMirror(function (node) {
            textarea.parentNode.insertBefore(node, textarea.nextSibling);
        }, options);
        cm.save = save;
        cm.getTextArea = function () {
            return textarea;
        };
        cm.toTextArea = function () {
            save();
            textarea.parentNode.removeChild(cm.getWrapperElement());
            textarea.style.display = "";
            if (textarea.form) {
                off(textarea.form, "submit", save);
                if (typeof textarea.form.submit == "function")
                    textarea.form.submit = realSubmit;
            }
        };
        return cm;
    };

    // STRING STREAM

    // Fed to the mode parsers, provides helper functions to make
    // parsers more succinct.

    var StringStream = CodeMirror.StringStream = function (string, tabSize) {
        this.pos = this.start = 0;
        this.string = string;
        this.tabSize = tabSize || 8;
        this.lastColumnPos = this.lastColumnValue = 0;
        this.lineStart = 0;
    };

    StringStream.prototype = {
        eol: function () {
            return this.pos >= this.string.length;
        },
        sol: function () {
            return this.pos == this.lineStart;
        },
        peek: function () {
            return this.string.charAt(this.pos) || undefined;
        },
        next: function () {
            if (this.pos < this.string.length)
                return this.string.charAt(this.pos++);
        },
        eat: function (match) {
            var ch = this.string.charAt(this.pos);
            if (typeof match == "string")
                var ok = ch == match;
            else
                var ok = ch && (match.test ? match.test(ch) : match(ch));
            if (ok) {
                ++this.pos;
                return ch;
            }
        },
        eatWhile: function (match) {
            var start = this.pos;
            while (this.eat(match)) {
            }
            return this.pos > start;
        },
        eatSpace: function () {
            var start = this.pos;
            while (/[\s\u00a0]/.test(this.string.charAt(this.pos)))
                ++this.pos;
            return this.pos > start;
        },
        skipToEnd: function () {
            this.pos = this.string.length;
        },
        skipTo: function (ch) {
            var found = this.string.indexOf(ch, this.pos);
            if (found > -1) {
                this.pos = found;
                return true;
            }
        },
        backUp: function (n) {
            this.pos -= n;
        },
        column: function () {
            if (this.lastColumnPos < this.start) {
                this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue);
                this.lastColumnPos = this.start;
            }
            return this.lastColumnValue - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
        },
        indentation: function () {
            return countColumn(this.string, null, this.tabSize) -
                    (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
        },
        match: function (pattern, consume, caseInsensitive) {
            if (typeof pattern == "string") {
                var cased = function (str) {
                    return caseInsensitive ? str.toLowerCase() : str;
                };
                var substr = this.string.substr(this.pos, pattern.length);
                if (cased(substr) == cased(pattern)) {
                    if (consume !== false)
                        this.pos += pattern.length;
                    return true;
                }
            } else {
                var match = this.string.slice(this.pos).match(pattern);
                if (match && match.index > 0)
                    return null;
                if (match && consume !== false)
                    this.pos += match[0].length;
                return match;
            }
        },
        current: function () {
            return this.string.slice(this.start, this.pos);
        },
        hideFirstChars: function (n, inner) {
            this.lineStart += n;
            try {
                return inner();
            } finally {
                this.lineStart -= n;
            }
        }
    };

    // TEXTMARKERS

    // Created with markText and setBookmark methods. A TextMarker is a
    // handle that can be used to clear or find a marked position in the
    // document. Line objects hold arrays (markedSpans) containing
    // {from, to, marker} object pointing to such marker objects, and
    // indicating that such a marker is present on that line. Multiple
    // lines may point to the same marker when it spans across lines.
    // The spans will have null for their from/to properties when the
    // marker continues beyond the start/end of the line. Markers have
    // links back to the lines they currently touch.

    var TextMarker = CodeMirror.TextMarker = function (doc, type) {
        this.lines = [];
        this.type = type;
        this.doc = doc;
    };
    eventMixin(TextMarker);

    // Clear the marker.
    TextMarker.prototype.clear = function () {
        if (this.explicitlyCleared)
            return;
        var cm = this.doc.cm, withOp = cm && !cm.curOp;
        if (withOp)
            startOperation(cm);
        if (hasHandler(this, "clear")) {
            var found = this.find();
            if (found)
                signalLater(this, "clear", found.from, found.to);
        }
        var min = null, max = null;
        for (var i = 0; i < this.lines.length; ++i) {
            var line = this.lines[i];
            var span = getMarkedSpanFor(line.markedSpans, this);
            if (cm && !this.collapsed)
                regLineChange(cm, lineNo(line), "text");
            else if (cm) {
                if (span.to != null)
                    max = lineNo(line);
                if (span.from != null)
                    min = lineNo(line);
            }
            line.markedSpans = removeMarkedSpan(line.markedSpans, span);
            if (span.from == null && this.collapsed && !lineIsHidden(this.doc, line) && cm)
                updateLineHeight(line, textHeight(cm.display));
        }
        if (cm && this.collapsed && !cm.options.lineWrapping)
            for (var i = 0; i < this.lines.length; ++i) {
                var visual = visualLine(this.lines[i]), len = lineLength(visual);
                if (len > cm.display.maxLineLength) {
                    cm.display.maxLine = visual;
                    cm.display.maxLineLength = len;
                    cm.display.maxLineChanged = true;
                }
            }

        if (min != null && cm && this.collapsed)
            regChange(cm, min, max + 1);
        this.lines.length = 0;
        this.explicitlyCleared = true;
        if (this.atomic && this.doc.cantEdit) {
            this.doc.cantEdit = false;
            if (cm)
                reCheckSelection(cm.doc);
        }
        if (cm)
            signalLater(cm, "markerCleared", cm, this);
        if (withOp)
            endOperation(cm);
        if (this.parent)
            this.parent.clear();
    };

    // Find the position of the marker in the document. Returns a {from,
    // to} object by default. Side can be passed to get a specific side
    // -- 0 (both), -1 (left), or 1 (right). When lineObj is true, the
    // Pos objects returned contain a line object, rather than a line
    // number (used to prevent looking up the same line twice).
    TextMarker.prototype.find = function (side, lineObj) {
        if (side == null && this.type == "bookmark")
            side = 1;
        var from, to;
        for (var i = 0; i < this.lines.length; ++i) {
            var line = this.lines[i];
            var span = getMarkedSpanFor(line.markedSpans, this);
            if (span.from != null) {
                from = Pos(lineObj ? line : lineNo(line), span.from);
                if (side == -1)
                    return from;
            }
            if (span.to != null) {
                to = Pos(lineObj ? line : lineNo(line), span.to);
                if (side == 1)
                    return to;
            }
        }
        return from && {from: from, to: to};
    };

    // Signals that the marker's widget changed, and surrounding layout
    // should be recomputed.
    TextMarker.prototype.changed = function () {
        var pos = this.find(-1, true), widget = this, cm = this.doc.cm;
        if (!pos || !cm)
            return;
        runInOp(cm, function () {
            var line = pos.line, lineN = lineNo(pos.line);
            var view = findViewForLine(cm, lineN);
            if (view) {
                clearLineMeasurementCacheFor(view);
                cm.curOp.selectionChanged = cm.curOp.forceUpdate = true;
            }
            cm.curOp.updateMaxLine = true;
            if (!lineIsHidden(widget.doc, line) && widget.height != null) {
                var oldHeight = widget.height;
                widget.height = null;
                var dHeight = widgetHeight(widget) - oldHeight;
                if (dHeight)
                    updateLineHeight(line, line.height + dHeight);
            }
        });
    };

    TextMarker.prototype.attachLine = function (line) {
        if (!this.lines.length && this.doc.cm) {
            var op = this.doc.cm.curOp;
            if (!op.maybeHiddenMarkers || indexOf(op.maybeHiddenMarkers, this) == -1)
                (op.maybeUnhiddenMarkers || (op.maybeUnhiddenMarkers = [])).push(this);
        }
        this.lines.push(line);
    };
    TextMarker.prototype.detachLine = function (line) {
        this.lines.splice(indexOf(this.lines, line), 1);
        if (!this.lines.length && this.doc.cm) {
            var op = this.doc.cm.curOp;
            (op.maybeHiddenMarkers || (op.maybeHiddenMarkers = [])).push(this);
        }
    };

    // Collapsed markers have unique ids, in order to be able to order
    // them, which is needed for uniquely determining an outer marker
    // when they overlap (they may nest, but not partially overlap).
    var nextMarkerId = 0;

    // Create a marker, wire it up to the right lines, and
    function markText(doc, from, to, options, type) {
        // Shared markers (across linked documents) are handled separately
        // (markTextShared will call out to this again, once per
        // document).
        if (options && options.shared)
            return markTextShared(doc, from, to, options, type);
        // Ensure we are in an operation.
        if (doc.cm && !doc.cm.curOp)
            return operation(doc.cm, markText)(doc, from, to, options, type);

        var marker = new TextMarker(doc, type), diff = cmp(from, to);
        if (options)
            copyObj(options, marker, false);
        // Don't connect empty markers unless clearWhenEmpty is false
        if (diff > 0 || diff == 0 && marker.clearWhenEmpty !== false)
            return marker;
        if (marker.replacedWith) {
            // Showing up as a widget implies collapsed (widget replaces text)
            marker.collapsed = true;
            marker.widgetNode = elt("span", [marker.replacedWith], "CodeMirror-widget");
            if (!options.handleMouseEvents)
                marker.widgetNode.ignoreEvents = true;
            if (options.insertLeft)
                marker.widgetNode.insertLeft = true;
        }
        if (marker.collapsed) {
            if (conflictingCollapsedRange(doc, from.line, from, to, marker) ||
                    from.line != to.line && conflictingCollapsedRange(doc, to.line, from, to, marker))
                throw new Error("Inserting collapsed marker partially overlapping an existing one");
            sawCollapsedSpans = true;
        }

        if (marker.addToHistory)
            addChangeToHistory(doc, {from: from, to: to, origin: "markText"}, doc.sel, NaN);

        var curLine = from.line, cm = doc.cm, updateMaxLine;
        doc.iter(curLine, to.line + 1, function (line) {
            if (cm && marker.collapsed && !cm.options.lineWrapping && visualLine(line) == cm.display.maxLine)
                updateMaxLine = true;
            if (marker.collapsed && curLine != from.line)
                updateLineHeight(line, 0);
            addMarkedSpan(line, new MarkedSpan(marker,
                    curLine == from.line ? from.ch : null,
                    curLine == to.line ? to.ch : null));
            ++curLine;
        });
        // lineIsHidden depends on the presence of the spans, so needs a second pass
        if (marker.collapsed)
            doc.iter(from.line, to.line + 1, function (line) {
                if (lineIsHidden(doc, line))
                    updateLineHeight(line, 0);
            });

        if (marker.clearOnEnter)
            on(marker, "beforeCursorEnter", function () {
                marker.clear();
            });

        if (marker.readOnly) {
            sawReadOnlySpans = true;
            if (doc.history.done.length || doc.history.undone.length)
                doc.clearHistory();
        }
        if (marker.collapsed) {
            marker.id = ++nextMarkerId;
            marker.atomic = true;
        }
        if (cm) {
            // Sync editor state
            if (updateMaxLine)
                cm.curOp.updateMaxLine = true;
            if (marker.collapsed)
                regChange(cm, from.line, to.line + 1);
            else if (marker.className || marker.title || marker.startStyle || marker.endStyle)
                for (var i = from.line; i <= to.line; i++)
                    regLineChange(cm, i, "text");
            if (marker.atomic)
                reCheckSelection(cm.doc);
            signalLater(cm, "markerAdded", cm, marker);
        }
        return marker;
    }

    // SHARED TEXTMARKERS

    // A shared marker spans multiple linked documents. It is
    // implemented as a meta-marker-object controlling multiple normal
    // markers.
    var SharedTextMarker = CodeMirror.SharedTextMarker = function (markers, primary) {
        this.markers = markers;
        this.primary = primary;
        for (var i = 0; i < markers.length; ++i)
            markers[i].parent = this;
    };
    eventMixin(SharedTextMarker);

    SharedTextMarker.prototype.clear = function () {
        if (this.explicitlyCleared)
            return;
        this.explicitlyCleared = true;
        for (var i = 0; i < this.markers.length; ++i)
            this.markers[i].clear();
        signalLater(this, "clear");
    };
    SharedTextMarker.prototype.find = function (side, lineObj) {
        return this.primary.find(side, lineObj);
    };

    function markTextShared(doc, from, to, options, type) {
        options = copyObj(options);
        options.shared = false;
        var markers = [markText(doc, from, to, options, type)], primary = markers[0];
        var widget = options.widgetNode;
        linkedDocs(doc, function (doc) {
            if (widget)
                options.widgetNode = widget.cloneNode(true);
            markers.push(markText(doc, clipPos(doc, from), clipPos(doc, to), options, type));
            for (var i = 0; i < doc.linked.length; ++i)
                if (doc.linked[i].isParent)
                    return;
            primary = lst(markers);
        });
        return new SharedTextMarker(markers, primary);
    }

    function findSharedMarkers(doc) {
        return doc.findMarks(Pos(doc.first, 0), doc.clipPos(Pos(doc.lastLine())),
                function (m) {
                    return m.parent;
                });
    }

    function copySharedMarkers(doc, markers) {
        for (var i = 0; i < markers.length; i++) {
            var marker = markers[i], pos = marker.find();
            var mFrom = doc.clipPos(pos.from), mTo = doc.clipPos(pos.to);
            if (cmp(mFrom, mTo)) {
                var subMark = markText(doc, mFrom, mTo, marker.primary, marker.primary.type);
                marker.markers.push(subMark);
                subMark.parent = marker;
            }
        }
    }

    function detachSharedMarkers(markers) {
        for (var i = 0; i < markers.length; i++) {
            var marker = markers[i], linked = [marker.primary.doc];
            ;
            linkedDocs(marker.primary.doc, function (d) {
                linked.push(d);
            });
            for (var j = 0; j < marker.markers.length; j++) {
                var subMarker = marker.markers[j];
                if (indexOf(linked, subMarker.doc) == -1) {
                    subMarker.parent = null;
                    marker.markers.splice(j--, 1);
                }
            }
        }
    }

    // TEXTMARKER SPANS

    function MarkedSpan(marker, from, to) {
        this.marker = marker;
        this.from = from;
        this.to = to;
    }

    // Search an array of spans for a span matching the given marker.
    function getMarkedSpanFor(spans, marker) {
        if (spans)
            for (var i = 0; i < spans.length; ++i) {
                var span = spans[i];
                if (span.marker == marker)
                    return span;
            }
    }
    // Remove a span from an array, returning undefined if no spans are
    // left (we don't store arrays for lines without spans).
    function removeMarkedSpan(spans, span) {
        for (var r, i = 0; i < spans.length; ++i)
            if (spans[i] != span)
                (r || (r = [])).push(spans[i]);
        return r;
    }
    // Add a span to a line.
    function addMarkedSpan(line, span) {
        line.markedSpans = line.markedSpans ? line.markedSpans.concat([span]) : [span];
        span.marker.attachLine(line);
    }

    // Used for the algorithm that adjusts markers for a change in the
    // document. These functions cut an array of spans at a given
    // character position, returning an array of remaining chunks (or
    // undefined if nothing remains).
    function markedSpansBefore(old, startCh, isInsert) {
        if (old)
            for (var i = 0, nw; i < old.length; ++i) {
                var span = old[i], marker = span.marker;
                var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= startCh : span.from < startCh);
                if (startsBefore || span.from == startCh && marker.type == "bookmark" && (!isInsert || !span.marker.insertLeft)) {
                    var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= startCh : span.to > startCh);
                    (nw || (nw = [])).push(new MarkedSpan(marker, span.from, endsAfter ? null : span.to));
                }
            }
        return nw;
    }
    function markedSpansAfter(old, endCh, isInsert) {
        if (old)
            for (var i = 0, nw; i < old.length; ++i) {
                var span = old[i], marker = span.marker;
                var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= endCh : span.to > endCh);
                if (endsAfter || span.from == endCh && marker.type == "bookmark" && (!isInsert || span.marker.insertLeft)) {
                    var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= endCh : span.from < endCh);
                    (nw || (nw = [])).push(new MarkedSpan(marker, startsBefore ? null : span.from - endCh,
                            span.to == null ? null : span.to - endCh));
                }
            }
        return nw;
    }

    // Given a change object, compute the new set of marker spans that
    // cover the line in which the change took place. Removes spans
    // entirely within the change, reconnects spans belonging to the
    // same marker that appear on both sides of the change, and cuts off
    // spans partially within the change. Returns an array of span
    // arrays with one element for each line in (after) the change.
    function stretchSpansOverChange(doc, change) {
        var oldFirst = isLine(doc, change.from.line) && getLine(doc, change.from.line).markedSpans;
        var oldLast = isLine(doc, change.to.line) && getLine(doc, change.to.line).markedSpans;
        if (!oldFirst && !oldLast)
            return null;

        var startCh = change.from.ch, endCh = change.to.ch, isInsert = cmp(change.from, change.to) == 0;
        // Get the spans that 'stick out' on both sides
        var first = markedSpansBefore(oldFirst, startCh, isInsert);
        var last = markedSpansAfter(oldLast, endCh, isInsert);

        // Next, merge those two ends
        var sameLine = change.text.length == 1, offset = lst(change.text).length + (sameLine ? startCh : 0);
        if (first) {
            // Fix up .to properties of first
            for (var i = 0; i < first.length; ++i) {
                var span = first[i];
                if (span.to == null) {
                    var found = getMarkedSpanFor(last, span.marker);
                    if (!found)
                        span.to = startCh;
                    else if (sameLine)
                        span.to = found.to == null ? null : found.to + offset;
                }
            }
        }
        if (last) {
            // Fix up .from in last (or move them into first in case of sameLine)
            for (var i = 0; i < last.length; ++i) {
                var span = last[i];
                if (span.to != null)
                    span.to += offset;
                if (span.from == null) {
                    var found = getMarkedSpanFor(first, span.marker);
                    if (!found) {
                        span.from = offset;
                        if (sameLine)
                            (first || (first = [])).push(span);
                    }
                } else {
                    span.from += offset;
                    if (sameLine)
                        (first || (first = [])).push(span);
                }
            }
        }
        // Make sure we didn't create any zero-length spans
        if (first)
            first = clearEmptySpans(first);
        if (last && last != first)
            last = clearEmptySpans(last);

        var newMarkers = [first];
        if (!sameLine) {
            // Fill gap with whole-line-spans
            var gap = change.text.length - 2, gapMarkers;
            if (gap > 0 && first)
                for (var i = 0; i < first.length; ++i)
                    if (first[i].to == null)
                        (gapMarkers || (gapMarkers = [])).push(new MarkedSpan(first[i].marker, null, null));
            for (var i = 0; i < gap; ++i)
                newMarkers.push(gapMarkers);
            newMarkers.push(last);
        }
        return newMarkers;
    }

    // Remove spans that are empty and don't have a clearWhenEmpty
    // option of false.
    function clearEmptySpans(spans) {
        for (var i = 0; i < spans.length; ++i) {
            var span = spans[i];
            if (span.from != null && span.from == span.to && span.marker.clearWhenEmpty !== false)
                spans.splice(i--, 1);
        }
        if (!spans.length)
            return null;
        return spans;
    }

    // Used for un/re-doing changes from the history. Combines the
    // result of computing the existing spans with the set of spans that
    // existed in the history (so that deleting around a span and then
    // undoing brings back the span).
    function mergeOldSpans(doc, change) {
        var old = getOldSpans(doc, change);
        var stretched = stretchSpansOverChange(doc, change);
        if (!old)
            return stretched;
        if (!stretched)
            return old;

        for (var i = 0; i < old.length; ++i) {
            var oldCur = old[i], stretchCur = stretched[i];
            if (oldCur && stretchCur) {
                spans: for (var j = 0; j < stretchCur.length; ++j) {
                    var span = stretchCur[j];
                    for (var k = 0; k < oldCur.length; ++k)
                        if (oldCur[k].marker == span.marker)
                            continue spans;
                    oldCur.push(span);
                }
            } else if (stretchCur) {
                old[i] = stretchCur;
            }
        }
        return old;
    }

    // Used to 'clip' out readOnly ranges when making a change.
    function removeReadOnlyRanges(doc, from, to) {
        var markers = null;
        doc.iter(from.line, to.line + 1, function (line) {
            if (line.markedSpans)
                for (var i = 0; i < line.markedSpans.length; ++i) {
                    var mark = line.markedSpans[i].marker;
                    if (mark.readOnly && (!markers || indexOf(markers, mark) == -1))
                        (markers || (markers = [])).push(mark);
                }
        });
        if (!markers)
            return null;
        var parts = [{from: from, to: to}];
        for (var i = 0; i < markers.length; ++i) {
            var mk = markers[i], m = mk.find(0);
            for (var j = 0; j < parts.length; ++j) {
                var p = parts[j];
                if (cmp(p.to, m.from) < 0 || cmp(p.from, m.to) > 0)
                    continue;
                var newParts = [j, 1], dfrom = cmp(p.from, m.from), dto = cmp(p.to, m.to);
                if (dfrom < 0 || !mk.inclusiveLeft && !dfrom)
                    newParts.push({from: p.from, to: m.from});
                if (dto > 0 || !mk.inclusiveRight && !dto)
                    newParts.push({from: m.to, to: p.to});
                parts.splice.apply(parts, newParts);
                j += newParts.length - 1;
            }
        }
        return parts;
    }

    // Connect or disconnect spans from a line.
    function detachMarkedSpans(line) {
        var spans = line.markedSpans;
        if (!spans)
            return;
        for (var i = 0; i < spans.length; ++i)
            spans[i].marker.detachLine(line);
        line.markedSpans = null;
    }
    function attachMarkedSpans(line, spans) {
        if (!spans)
            return;
        for (var i = 0; i < spans.length; ++i)
            spans[i].marker.attachLine(line);
        line.markedSpans = spans;
    }

    // Helpers used when computing which overlapping collapsed span
    // counts as the larger one.
    function extraLeft(marker) {
        return marker.inclusiveLeft ? -1 : 0;
    }
    function extraRight(marker) {
        return marker.inclusiveRight ? 1 : 0;
    }

    // Returns a number indicating which of two overlapping collapsed
    // spans is larger (and thus includes the other). Falls back to
    // comparing ids when the spans cover exactly the same range.
    function compareCollapsedMarkers(a, b) {
        var lenDiff = a.lines.length - b.lines.length;
        if (lenDiff != 0)
            return lenDiff;
        var aPos = a.find(), bPos = b.find();
        var fromCmp = cmp(aPos.from, bPos.from) || extraLeft(a) - extraLeft(b);
        if (fromCmp)
            return -fromCmp;
        var toCmp = cmp(aPos.to, bPos.to) || extraRight(a) - extraRight(b);
        if (toCmp)
            return toCmp;
        return b.id - a.id;
    }

    // Find out whether a line ends or starts in a collapsed span. If
    // so, return the marker for that span.
    function collapsedSpanAtSide(line, start) {
        var sps = sawCollapsedSpans && line.markedSpans, found;
        if (sps)
            for (var sp, i = 0; i < sps.length; ++i) {
                sp = sps[i];
                if (sp.marker.collapsed && (start ? sp.from : sp.to) == null &&
                        (!found || compareCollapsedMarkers(found, sp.marker) < 0))
                    found = sp.marker;
            }
        return found;
    }
    function collapsedSpanAtStart(line) {
        return collapsedSpanAtSide(line, true);
    }
    function collapsedSpanAtEnd(line) {
        return collapsedSpanAtSide(line, false);
    }

    // Test whether there exists a collapsed span that partially
    // overlaps (covers the start or end, but not both) of a new span.
    // Such overlap is not allowed.
    function conflictingCollapsedRange(doc, lineNo, from, to, marker) {
        var line = getLine(doc, lineNo);
        var sps = sawCollapsedSpans && line.markedSpans;
        if (sps)
            for (var i = 0; i < sps.length; ++i) {
                var sp = sps[i];
                if (!sp.marker.collapsed)
                    continue;
                var found = sp.marker.find(0);
                var fromCmp = cmp(found.from, from) || extraLeft(sp.marker) - extraLeft(marker);
                var toCmp = cmp(found.to, to) || extraRight(sp.marker) - extraRight(marker);
                if (fromCmp >= 0 && toCmp <= 0 || fromCmp <= 0 && toCmp >= 0)
                    continue;
                if (fromCmp <= 0 && (cmp(found.to, from) || extraRight(sp.marker) - extraLeft(marker)) > 0 ||
                        fromCmp >= 0 && (cmp(found.from, to) || extraLeft(sp.marker) - extraRight(marker)) < 0)
                    return true;
            }
    }

    // A visual line is a line as drawn on the screen. Folding, for
    // example, can cause multiple logical lines to appear on the same
    // visual line. This finds the start of the visual line that the
    // given line is part of (usually that is the line itself).
    function visualLine(line) {
        var merged;
        while (merged = collapsedSpanAtStart(line))
            line = merged.find(-1, true).line;
        return line;
    }

    // Returns an array of logical lines that continue the visual line
    // started by the argument, or undefined if there are no such lines.
    function visualLineContinued(line) {
        var merged, lines;
        while (merged = collapsedSpanAtEnd(line)) {
            line = merged.find(1, true).line;
            (lines || (lines = [])).push(line);
        }
        return lines;
    }

    // Get the line number of the start of the visual line that the
    // given line number is part of.
    function visualLineNo(doc, lineN) {
        var line = getLine(doc, lineN), vis = visualLine(line);
        if (line == vis)
            return lineN;
        return lineNo(vis);
    }
    // Get the line number of the start of the next visual line after
    // the given line.
    function visualLineEndNo(doc, lineN) {
        if (lineN > doc.lastLine())
            return lineN;
        var line = getLine(doc, lineN), merged;
        if (!lineIsHidden(doc, line))
            return lineN;
        while (merged = collapsedSpanAtEnd(line))
            line = merged.find(1, true).line;
        return lineNo(line) + 1;
    }

    // Compute whether a line is hidden. Lines count as hidden when they
    // are part of a visual line that starts with another line, or when
    // they are entirely covered by collapsed, non-widget span.
    function lineIsHidden(doc, line) {
        var sps = sawCollapsedSpans && line.markedSpans;
        if (sps)
            for (var sp, i = 0; i < sps.length; ++i) {
                sp = sps[i];
                if (!sp.marker.collapsed)
                    continue;
                if (sp.from == null)
                    return true;
                if (sp.marker.widgetNode)
                    continue;
                if (sp.from == 0 && sp.marker.inclusiveLeft && lineIsHiddenInner(doc, line, sp))
                    return true;
            }
    }
    function lineIsHiddenInner(doc, line, span) {
        if (span.to == null) {
            var end = span.marker.find(1, true);
            return lineIsHiddenInner(doc, end.line, getMarkedSpanFor(end.line.markedSpans, span.marker));
        }
        if (span.marker.inclusiveRight && span.to == line.text.length)
            return true;
        for (var sp, i = 0; i < line.markedSpans.length; ++i) {
            sp = line.markedSpans[i];
            if (sp.marker.collapsed && !sp.marker.widgetNode && sp.from == span.to &&
                    (sp.to == null || sp.to != span.from) &&
                    (sp.marker.inclusiveLeft || span.marker.inclusiveRight) &&
                    lineIsHiddenInner(doc, line, sp))
                return true;
        }
    }

    // LINE WIDGETS

    // Line widgets are block elements displayed above or below a line.

    var LineWidget = CodeMirror.LineWidget = function (cm, node, options) {
        if (options)
            for (var opt in options)
                if (options.hasOwnProperty(opt))
                    this[opt] = options[opt];
        this.cm = cm;
        this.node = node;
    };
    eventMixin(LineWidget);

    function adjustScrollWhenAboveVisible(cm, line, diff) {
        if (heightAtLine(line) < ((cm.curOp && cm.curOp.scrollTop) || cm.doc.scrollTop))
            addToScrollPos(cm, null, diff);
    }

    LineWidget.prototype.clear = function () {
        var cm = this.cm, ws = this.line.widgets, line = this.line, no = lineNo(line);
        if (no == null || !ws)
            return;
        for (var i = 0; i < ws.length; ++i)
            if (ws[i] == this)
                ws.splice(i--, 1);
        if (!ws.length)
            line.widgets = null;
        var height = widgetHeight(this);
        runInOp(cm, function () {
            adjustScrollWhenAboveVisible(cm, line, -height);
            regLineChange(cm, no, "widget");
            updateLineHeight(line, Math.max(0, line.height - height));
        });
    };
    LineWidget.prototype.changed = function () {
        var oldH = this.height, cm = this.cm, line = this.line;
        this.height = null;
        var diff = widgetHeight(this) - oldH;
        if (!diff)
            return;
        runInOp(cm, function () {
            cm.curOp.forceUpdate = true;
            adjustScrollWhenAboveVisible(cm, line, diff);
            updateLineHeight(line, line.height + diff);
        });
    };

    function widgetHeight(widget) {
        if (widget.height != null)
            return widget.height;
        if (!contains(document.body, widget.node))
            removeChildrenAndAdd(widget.cm.display.measure, elt("div", [widget.node], null, "position: relative"));
        return widget.height = widget.node.offsetHeight;
    }

    function addLineWidget(cm, handle, node, options) {
        var widget = new LineWidget(cm, node, options);
        if (widget.noHScroll)
            cm.display.alignWidgets = true;
        changeLine(cm, handle, "widget", function (line) {
            var widgets = line.widgets || (line.widgets = []);
            if (widget.insertAt == null)
                widgets.push(widget);
            else
                widgets.splice(Math.min(widgets.length - 1, Math.max(0, widget.insertAt)), 0, widget);
            widget.line = line;
            if (!lineIsHidden(cm.doc, line)) {
                var aboveVisible = heightAtLine(line) < cm.doc.scrollTop;
                updateLineHeight(line, line.height + widgetHeight(widget));
                if (aboveVisible)
                    addToScrollPos(cm, null, widget.height);
                cm.curOp.forceUpdate = true;
            }
            return true;
        });
        return widget;
    }

    // LINE DATA STRUCTURE

    // Line objects. These hold state related to a line, including
    // highlighting info (the styles array).
    var Line = CodeMirror.Line = function (text, markedSpans, estimateHeight) {
        this.text = text;
        attachMarkedSpans(this, markedSpans);
        this.height = estimateHeight ? estimateHeight(this) : 1;
    };
    eventMixin(Line);
    Line.prototype.lineNo = function () {
        return lineNo(this);
    };

    // Change the content (text, markers) of a line. Automatically
    // invalidates cached information and tries to re-estimate the
    // line's height.
    function updateLine(line, text, markedSpans, estimateHeight) {
        line.text = text;
        if (line.stateAfter)
            line.stateAfter = null;
        if (line.styles)
            line.styles = null;
        if (line.order != null)
            line.order = null;
        detachMarkedSpans(line);
        attachMarkedSpans(line, markedSpans);
        var estHeight = estimateHeight ? estimateHeight(line) : 1;
        if (estHeight != line.height)
            updateLineHeight(line, estHeight);
    }

    // Detach a line from the document tree and its markers.
    function cleanUpLine(line) {
        line.parent = null;
        detachMarkedSpans(line);
    }

    function extractLineClasses(type, output) {
        if (type)
            for (; ; ) {
                var lineClass = type.match(/(?:^|\s+)line-(background-)?(\S+)/);
                if (!lineClass)
                    break;
                type = type.slice(0, lineClass.index) + type.slice(lineClass.index + lineClass[0].length);
                var prop = lineClass[1] ? "bgClass" : "textClass";
                if (output[prop] == null)
                    output[prop] = lineClass[2];
                else if (!(new RegExp("(?:^|\s)" + lineClass[2] + "(?:$|\s)")).test(output[prop]))
                    output[prop] += " " + lineClass[2];
            }
        return type;
    }

    function callBlankLine(mode, state) {
        if (mode.blankLine)
            return mode.blankLine(state);
        if (!mode.innerMode)
            return;
        var inner = CodeMirror.innerMode(mode, state);
        if (inner.mode.blankLine)
            return inner.mode.blankLine(inner.state);
    }

    function readToken(mode, stream, state) {
        var style = mode.token(stream, state);
        if (stream.pos <= stream.start)
            throw new Error("Mode " + mode.name + " failed to advance stream.");
        return style;
    }

    // Run the given mode's parser over a line, calling f for each token.
    function runMode(cm, text, mode, state, f, lineClasses, forceToEnd) {
        var flattenSpans = mode.flattenSpans;
        if (flattenSpans == null)
            flattenSpans = cm.options.flattenSpans;
        var curStart = 0, curStyle = null;
        var stream = new StringStream(text, cm.options.tabSize), style;
        if (text == "")
            extractLineClasses(callBlankLine(mode, state), lineClasses);
        while (!stream.eol()) {
            if (stream.pos > cm.options.maxHighlightLength) {
                flattenSpans = false;
                if (forceToEnd)
                    processLine(cm, text, state, stream.pos);
                stream.pos = text.length;
                style = null;
            } else {
                style = extractLineClasses(readToken(mode, stream, state), lineClasses);
            }
            if (cm.options.addModeClass) {
                var mName = CodeMirror.innerMode(mode, state).mode.name;
                if (mName)
                    style = "m-" + (style ? mName + " " + style : mName);
            }
            if (!flattenSpans || curStyle != style) {
                if (curStart < stream.start)
                    f(stream.start, curStyle);
                curStart = stream.start;
                curStyle = style;
            }
            stream.start = stream.pos;
        }
        while (curStart < stream.pos) {
            // Webkit seems to refuse to render text nodes longer than 57444 characters
            var pos = Math.min(stream.pos, curStart + 50000);
            f(pos, curStyle);
            curStart = pos;
        }
    }

    // Compute a style array (an array starting with a mode generation
    // -- for invalidation -- followed by pairs of end positions and
    // style strings), which is used to highlight the tokens on the
    // line.
    function highlightLine(cm, line, state, forceToEnd) {
        // A styles array always starts with a number identifying the
        // mode/overlays that it is based on (for easy invalidation).
        var st = [cm.state.modeGen], lineClasses = {};
        // Compute the base array of styles
        runMode(cm, line.text, cm.doc.mode, state, function (end, style) {
            st.push(end, style);
        }, lineClasses, forceToEnd);

        // Run overlays, adjust style array.
        for (var o = 0; o < cm.state.overlays.length; ++o) {
            var overlay = cm.state.overlays[o], i = 1, at = 0;
            runMode(cm, line.text, overlay.mode, true, function (end, style) {
                var start = i;
                // Ensure there's a token end at the current position, and that i points at it
                while (at < end) {
                    var i_end = st[i];
                    if (i_end > end)
                        st.splice(i, 1, end, st[i + 1], i_end);
                    i += 2;
                    at = Math.min(end, i_end);
                }
                if (!style)
                    return;
                if (overlay.opaque) {
                    st.splice(start, i - start, end, "cm-overlay " + style);
                    i = start + 2;
                } else {
                    for (; start < i; start += 2) {
                        var cur = st[start + 1];
                        st[start + 1] = (cur ? cur + " " : "") + "cm-overlay " + style;
                    }
                }
            }, lineClasses);
        }

        return {styles: st, classes: lineClasses.bgClass || lineClasses.textClass ? lineClasses : null};
    }

    function getLineStyles(cm, line) {
        if (!line.styles || line.styles[0] != cm.state.modeGen) {
            var result = highlightLine(cm, line, line.stateAfter = getStateBefore(cm, lineNo(line)));
            line.styles = result.styles;
            if (result.classes)
                line.styleClasses = result.classes;
            else if (line.styleClasses)
                line.styleClasses = null;
        }
        return line.styles;
    }

    // Lightweight form of highlight -- proceed over this line and
    // update state, but don't save a style array. Used for lines that
    // aren't currently visible.
    function processLine(cm, text, state, startAt) {
        var mode = cm.doc.mode;
        var stream = new StringStream(text, cm.options.tabSize);
        stream.start = stream.pos = startAt || 0;
        if (text == "")
            callBlankLine(mode, state);
        while (!stream.eol() && stream.pos <= cm.options.maxHighlightLength) {
            readToken(mode, stream, state);
            stream.start = stream.pos;
        }
    }

    // Convert a style as returned by a mode (either null, or a string
    // containing one or more styles) to a CSS style. This is cached,
    // and also looks for line-wide styles.
    var styleToClassCache = {}, styleToClassCacheWithMode = {};
    function interpretTokenStyle(style, options) {
        if (!style || /^\s*$/.test(style))
            return null;
        var cache = options.addModeClass ? styleToClassCacheWithMode : styleToClassCache;
        return cache[style] ||
                (cache[style] = style.replace(/\S+/g, "cm-$&"));
    }

    // Render the DOM representation of the text of a line. Also builds
    // up a 'line map', which points at the DOM nodes that represent
    // specific stretches of text, and is used by the measuring code.
    // The returned object contains the DOM node, this map, and
    // information about line-wide styles that were set by the mode.
    function buildLineContent(cm, lineView) {
        // The padding-right forces the element to have a 'border', which
        // is needed on Webkit to be able to get line-level bounding
        // rectangles for it (in measureChar).
        var content = elt("span", null, null, webkit ? "padding-right: .1px" : null);
        var builder = {pre: elt("pre", [content]), content: content, col: 0, pos: 0, cm: cm};
        lineView.measure = {};

        // Iterate over the logical lines that make up this visual line.
        for (var i = 0; i <= (lineView.rest ? lineView.rest.length : 0); i++) {
            var line = i ? lineView.rest[i - 1] : lineView.line, order;
            builder.pos = 0;
            builder.addToken = buildToken;
            // Optionally wire in some hacks into the token-rendering
            // algorithm, to deal with browser quirks.
            if ((ie || webkit) && cm.getOption("lineWrapping"))
                builder.addToken = buildTokenSplitSpaces(builder.addToken);
            if (hasBadBidiRects(cm.display.measure) && (order = getOrder(line)))
                builder.addToken = buildTokenBadBidi(builder.addToken, order);
            builder.map = [];
            insertLineContent(line, builder, getLineStyles(cm, line));
            if (line.styleClasses) {
                if (line.styleClasses.bgClass)
                    builder.bgClass = joinClasses(line.styleClasses.bgClass, builder.bgClass || "");
                if (line.styleClasses.textClass)
                    builder.textClass = joinClasses(line.styleClasses.textClass, builder.textClass || "");
            }

            // Ensure at least a single node is present, for measuring.
            if (builder.map.length == 0)
                builder.map.push(0, 0, builder.content.appendChild(zeroWidthElement(cm.display.measure)));

            // Store the map and a cache object for the current logical line
            if (i == 0) {
                lineView.measure.map = builder.map;
                lineView.measure.cache = {};
            } else {
                (lineView.measure.maps || (lineView.measure.maps = [])).push(builder.map);
                (lineView.measure.caches || (lineView.measure.caches = [])).push({});
            }
        }

        signal(cm, "renderLine", cm, lineView.line, builder.pre);
        return builder;
    }

    function defaultSpecialCharPlaceholder(ch) {
        var token = elt("span", "\u2022", "cm-invalidchar");
        token.title = "\\u" + ch.charCodeAt(0).toString(16);
        return token;
    }

    // Build up the DOM representation for a single token, and add it to
    // the line map. Takes care to render special characters separately.
    function buildToken(builder, text, style, startStyle, endStyle, title) {
        if (!text)
            return;
        var special = builder.cm.options.specialChars, mustWrap = false;
        if (!special.test(text)) {
            builder.col += text.length;
            var content = document.createTextNode(text);
            builder.map.push(builder.pos, builder.pos + text.length, content);
            if (ie_upto8)
                mustWrap = true;
            builder.pos += text.length;
        } else {
            var content = document.createDocumentFragment(), pos = 0;
            while (true) {
                special.lastIndex = pos;
                var m = special.exec(text);
                var skipped = m ? m.index - pos : text.length - pos;
                if (skipped) {
                    var txt = document.createTextNode(text.slice(pos, pos + skipped));
                    if (ie_upto8)
                        content.appendChild(elt("span", [txt]));
                    else
                        content.appendChild(txt);
                    builder.map.push(builder.pos, builder.pos + skipped, txt);
                    builder.col += skipped;
                    builder.pos += skipped;
                }
                if (!m)
                    break;
                pos += skipped + 1;
                if (m[0] == "\t") {
                    var tabSize = builder.cm.options.tabSize, tabWidth = tabSize - builder.col % tabSize;
                    var txt = content.appendChild(elt("span", spaceStr(tabWidth), "cm-tab"));
                    builder.col += tabWidth;
                } else {
                    var txt = builder.cm.options.specialCharPlaceholder(m[0]);
                    if (ie_upto8)
                        content.appendChild(elt("span", [txt]));
                    else
                        content.appendChild(txt);
                    builder.col += 1;
                }
                builder.map.push(builder.pos, builder.pos + 1, txt);
                builder.pos++;
            }
        }
        if (style || startStyle || endStyle || mustWrap) {
            var fullStyle = style || "";
            if (startStyle)
                fullStyle += startStyle;
            if (endStyle)
                fullStyle += endStyle;
            var token = elt("span", [content], fullStyle);
            if (title)
                token.title = title;
            return builder.content.appendChild(token);
        }
        builder.content.appendChild(content);
    }

    function buildTokenSplitSpaces(inner) {
        function split(old) {
            var out = " ";
            for (var i = 0; i < old.length - 2; ++i)
                out += i % 2 ? " " : "\u00a0";
            out += " ";
            return out;
        }
        return function (builder, text, style, startStyle, endStyle, title) {
            inner(builder, text.replace(/ {3,}/g, split), style, startStyle, endStyle, title);
        };
    }

    // Work around nonsense dimensions being reported for stretches of
    // right-to-left text.
    function buildTokenBadBidi(inner, order) {
        return function (builder, text, style, startStyle, endStyle, title) {
            style = style ? style + " cm-force-border" : "cm-force-border";
            var start = builder.pos, end = start + text.length;
            for (; ; ) {
                // Find the part that overlaps with the start of this text
                for (var i = 0; i < order.length; i++) {
                    var part = order[i];
                    if (part.to > start && part.from <= start)
                        break;
                }
                if (part.to >= end)
                    return inner(builder, text, style, startStyle, endStyle, title);
                inner(builder, text.slice(0, part.to - start), style, startStyle, null, title);
                startStyle = null;
                text = text.slice(part.to - start);
                start = part.to;
            }
        };
    }

    function buildCollapsedSpan(builder, size, marker, ignoreWidget) {
        var widget = !ignoreWidget && marker.widgetNode;
        if (widget) {
            builder.map.push(builder.pos, builder.pos + size, widget);
            builder.content.appendChild(widget);
        }
        builder.pos += size;
    }

    // Outputs a number of spans to make up a line, taking highlighting
    // and marked text into account.
    function insertLineContent(line, builder, styles) {
        var spans = line.markedSpans, allText = line.text, at = 0;
        if (!spans) {
            for (var i = 1; i < styles.length; i += 2)
                builder.addToken(builder, allText.slice(at, at = styles[i]), interpretTokenStyle(styles[i + 1], builder.cm.options));
            return;
        }

        var len = allText.length, pos = 0, i = 1, text = "", style;
        var nextChange = 0, spanStyle, spanEndStyle, spanStartStyle, title, collapsed;
        for (; ; ) {
            if (nextChange == pos) { // Update current marker set
                spanStyle = spanEndStyle = spanStartStyle = title = "";
                collapsed = null;
                nextChange = Infinity;
                var foundBookmarks = [];
                for (var j = 0; j < spans.length; ++j) {
                    var sp = spans[j], m = sp.marker;
                    if (sp.from <= pos && (sp.to == null || sp.to > pos)) {
                        if (sp.to != null && nextChange > sp.to) {
                            nextChange = sp.to;
                            spanEndStyle = "";
                        }
                        if (m.className)
                            spanStyle += " " + m.className;
                        if (m.startStyle && sp.from == pos)
                            spanStartStyle += " " + m.startStyle;
                        if (m.endStyle && sp.to == nextChange)
                            spanEndStyle += " " + m.endStyle;
                        if (m.title && !title)
                            title = m.title;
                        if (m.collapsed && (!collapsed || compareCollapsedMarkers(collapsed.marker, m) < 0))
                            collapsed = sp;
                    } else if (sp.from > pos && nextChange > sp.from) {
                        nextChange = sp.from;
                    }
                    if (m.type == "bookmark" && sp.from == pos && m.widgetNode)
                        foundBookmarks.push(m);
                }
                if (collapsed && (collapsed.from || 0) == pos) {
                    buildCollapsedSpan(builder, (collapsed.to == null ? len + 1 : collapsed.to) - pos,
                            collapsed.marker, collapsed.from == null);
                    if (collapsed.to == null)
                        return;
                }
                if (!collapsed && foundBookmarks.length)
                    for (var j = 0; j < foundBookmarks.length; ++j)
                        buildCollapsedSpan(builder, 0, foundBookmarks[j]);
            }
            if (pos >= len)
                break;

            var upto = Math.min(len, nextChange);
            while (true) {
                if (text) {
                    var end = pos + text.length;
                    if (!collapsed) {
                        var tokenText = end > upto ? text.slice(0, upto - pos) : text;
                        builder.addToken(builder, tokenText, style ? style + spanStyle : spanStyle,
                                spanStartStyle, pos + tokenText.length == nextChange ? spanEndStyle : "", title);
                    }
                    if (end >= upto) {
                        text = text.slice(upto - pos);
                        pos = upto;
                        break;
                    }
                    pos = end;
                    spanStartStyle = "";
                }
                text = allText.slice(at, at = styles[i++]);
                style = interpretTokenStyle(styles[i++], builder.cm.options);
            }
        }
    }

    // DOCUMENT DATA STRUCTURE

    // By default, updates that start and end at the beginning of a line
    // are treated specially, in order to make the association of line
    // widgets and marker elements with the text behave more intuitive.
    function isWholeLineUpdate(doc, change) {
        return change.from.ch == 0 && change.to.ch == 0 && lst(change.text) == "" &&
                (!doc.cm || doc.cm.options.wholeLineUpdateBefore);
    }

    // Perform a change on the document data structure.
    function updateDoc(doc, change, markedSpans, estimateHeight) {
        function spansFor(n) {
            return markedSpans ? markedSpans[n] : null;
        }
        function update(line, text, spans) {
            updateLine(line, text, spans, estimateHeight);
            signalLater(line, "change", line, change);
        }

        var from = change.from, to = change.to, text = change.text;
        var firstLine = getLine(doc, from.line), lastLine = getLine(doc, to.line);
        var lastText = lst(text), lastSpans = spansFor(text.length - 1), nlines = to.line - from.line;

        // Adjust the line structure
        if (isWholeLineUpdate(doc, change)) {
            // This is a whole-line replace. Treated specially to make
            // sure line objects move the way they are supposed to.
            for (var i = 0, added = []; i < text.length - 1; ++i)
                added.push(new Line(text[i], spansFor(i), estimateHeight));
            update(lastLine, lastLine.text, lastSpans);
            if (nlines)
                doc.remove(from.line, nlines);
            if (added.length)
                doc.insert(from.line, added);
        } else if (firstLine == lastLine) {
            if (text.length == 1) {
                update(firstLine, firstLine.text.slice(0, from.ch) + lastText + firstLine.text.slice(to.ch), lastSpans);
            } else {
                for (var added = [], i = 1; i < text.length - 1; ++i)
                    added.push(new Line(text[i], spansFor(i), estimateHeight));
                added.push(new Line(lastText + firstLine.text.slice(to.ch), lastSpans, estimateHeight));
                update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
                doc.insert(from.line + 1, added);
            }
        } else if (text.length == 1) {
            update(firstLine, firstLine.text.slice(0, from.ch) + text[0] + lastLine.text.slice(to.ch), spansFor(0));
            doc.remove(from.line + 1, nlines);
        } else {
            update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
            update(lastLine, lastText + lastLine.text.slice(to.ch), lastSpans);
            for (var i = 1, added = []; i < text.length - 1; ++i)
                added.push(new Line(text[i], spansFor(i), estimateHeight));
            if (nlines > 1)
                doc.remove(from.line + 1, nlines - 1);
            doc.insert(from.line + 1, added);
        }

        signalLater(doc, "change", doc, change);
    }

    // The document is represented as a BTree consisting of leaves, with
    // chunk of lines in them, and branches, with up to ten leaves or
    // other branch nodes below them. The top node is always a branch
    // node, and is the document object itself (meaning it has
    // additional methods and properties).
    //
    // All nodes have parent links. The tree is used both to go from
    // line numbers to line objects, and to go from objects to numbers.
    // It also indexes by height, and is used to convert between height
    // and line object, and to find the total height of the document.
    //
    // See also http://marijnhaverbeke.nl/blog/codemirror-line-tree.html

    function LeafChunk(lines) {
        this.lines = lines;
        this.parent = null;
        for (var i = 0, height = 0; i < lines.length; ++i) {
            lines[i].parent = this;
            height += lines[i].height;
        }
        this.height = height;
    }

    LeafChunk.prototype = {
        chunkSize: function () {
            return this.lines.length;
        },
        // Remove the n lines at offset 'at'.
        removeInner: function (at, n) {
            for (var i = at, e = at + n; i < e; ++i) {
                var line = this.lines[i];
                this.height -= line.height;
                cleanUpLine(line);
                signalLater(line, "delete");
            }
            this.lines.splice(at, n);
        },
        // Helper used to collapse a small branch into a single leaf.
        collapse: function (lines) {
            lines.push.apply(lines, this.lines);
        },
        // Insert the given array of lines at offset 'at', count them as
        // having the given height.
        insertInner: function (at, lines, height) {
            this.height += height;
            this.lines = this.lines.slice(0, at).concat(lines).concat(this.lines.slice(at));
            for (var i = 0; i < lines.length; ++i)
                lines[i].parent = this;
        },
        // Used to iterate over a part of the tree.
        iterN: function (at, n, op) {
            for (var e = at + n; at < e; ++at)
                if (op(this.lines[at]))
                    return true;
        }
    };

    function BranchChunk(children) {
        this.children = children;
        var size = 0, height = 0;
        for (var i = 0; i < children.length; ++i) {
            var ch = children[i];
            size += ch.chunkSize();
            height += ch.height;
            ch.parent = this;
        }
        this.size = size;
        this.height = height;
        this.parent = null;
    }

    BranchChunk.prototype = {
        chunkSize: function () {
            return this.size;
        },
        removeInner: function (at, n) {
            this.size -= n;
            for (var i = 0; i < this.children.length; ++i) {
                var child = this.children[i], sz = child.chunkSize();
                if (at < sz) {
                    var rm = Math.min(n, sz - at), oldHeight = child.height;
                    child.removeInner(at, rm);
                    this.height -= oldHeight - child.height;
                    if (sz == rm) {
                        this.children.splice(i--, 1);
                        child.parent = null;
                    }
                    if ((n -= rm) == 0)
                        break;
                    at = 0;
                } else
                    at -= sz;
            }
            // If the result is smaller than 25 lines, ensure that it is a
            // single leaf node.
            if (this.size - n < 25 &&
                    (this.children.length > 1 || !(this.children[0] instanceof LeafChunk))) {
                var lines = [];
                this.collapse(lines);
                this.children = [new LeafChunk(lines)];
                this.children[0].parent = this;
            }
        },
        collapse: function (lines) {
            for (var i = 0; i < this.children.length; ++i)
                this.children[i].collapse(lines);
        },
        insertInner: function (at, lines, height) {
            this.size += lines.length;
            this.height += height;
            for (var i = 0; i < this.children.length; ++i) {
                var child = this.children[i], sz = child.chunkSize();
                if (at <= sz) {
                    child.insertInner(at, lines, height);
                    if (child.lines && child.lines.length > 50) {
                        while (child.lines.length > 50) {
                            var spilled = child.lines.splice(child.lines.length - 25, 25);
                            var newleaf = new LeafChunk(spilled);
                            child.height -= newleaf.height;
                            this.children.splice(i + 1, 0, newleaf);
                            newleaf.parent = this;
                        }
                        this.maybeSpill();
                    }
                    break;
                }
                at -= sz;
            }
        },
        // When a node has grown, check whether it should be split.
        maybeSpill: function () {
            if (this.children.length <= 10)
                return;
            var me = this;
            do {
                var spilled = me.children.splice(me.children.length - 5, 5);
                var sibling = new BranchChunk(spilled);
                if (!me.parent) { // Become the parent node
                    var copy = new BranchChunk(me.children);
                    copy.parent = me;
                    me.children = [copy, sibling];
                    me = copy;
                } else {
                    me.size -= sibling.size;
                    me.height -= sibling.height;
                    var myIndex = indexOf(me.parent.children, me);
                    me.parent.children.splice(myIndex + 1, 0, sibling);
                }
                sibling.parent = me.parent;
            } while (me.children.length > 10);
            me.parent.maybeSpill();
        },
        iterN: function (at, n, op) {
            for (var i = 0; i < this.children.length; ++i) {
                var child = this.children[i], sz = child.chunkSize();
                if (at < sz) {
                    var used = Math.min(n, sz - at);
                    if (child.iterN(at, used, op))
                        return true;
                    if ((n -= used) == 0)
                        break;
                    at = 0;
                } else
                    at -= sz;
            }
        }
    };

    var nextDocId = 0;
    var Doc = CodeMirror.Doc = function (text, mode, firstLine) {
        if (!(this instanceof Doc))
            return new Doc(text, mode, firstLine);
        if (firstLine == null)
            firstLine = 0;

        BranchChunk.call(this, [new LeafChunk([new Line("", null)])]);
        this.first = firstLine;
        this.scrollTop = this.scrollLeft = 0;
        this.cantEdit = false;
        this.cleanGeneration = 1;
        this.frontier = firstLine;
        var start = Pos(firstLine, 0);
        this.sel = simpleSelection(start);
        this.history = new History(null);
        this.id = ++nextDocId;
        this.modeOption = mode;

        if (typeof text == "string")
            text = splitLines(text);
        updateDoc(this, {from: start, to: start, text: text});
        setSelection(this, simpleSelection(start), sel_dontScroll);
    };

    Doc.prototype = createObj(BranchChunk.prototype, {
        constructor: Doc,
        // Iterate over the document. Supports two forms -- with only one
        // argument, it calls that for each line in the document. With
        // three, it iterates over the range given by the first two (with
        // the second being non-inclusive).
        iter: function (from, to, op) {
            if (op)
                this.iterN(from - this.first, to - from, op);
            else
                this.iterN(this.first, this.first + this.size, from);
        },
        // Non-public interface for adding and removing lines.
        insert: function (at, lines) {
            var height = 0;
            for (var i = 0; i < lines.length; ++i)
                height += lines[i].height;
            this.insertInner(at - this.first, lines, height);
        },
        remove: function (at, n) {
            this.removeInner(at - this.first, n);
        },
        // From here, the methods are part of the public interface. Most
        // are also available from CodeMirror (editor) instances.

        getValue: function (lineSep) {
            var lines = getLines(this, this.first, this.first + this.size);
            if (lineSep === false)
                return lines;
            return lines.join(lineSep || "\n");
        },
        setValue: docMethodOp(function (code) {
            var top = Pos(this.first, 0), last = this.first + this.size - 1;
            makeChange(this, {from: top, to: Pos(last, getLine(this, last).text.length),
                text: splitLines(code), origin: "setValue"}, true);
            setSelection(this, simpleSelection(top));
        }),
        replaceRange: function (code, from, to, origin) {
            from = clipPos(this, from);
            to = to ? clipPos(this, to) : from;
            replaceRange(this, code, from, to, origin);
        },
        getRange: function (from, to, lineSep) {
            var lines = getBetween(this, clipPos(this, from), clipPos(this, to));
            if (lineSep === false)
                return lines;
            return lines.join(lineSep || "\n");
        },
        getLine: function (line) {
            var l = this.getLineHandle(line);
            return l && l.text;
        },
        getLineHandle: function (line) {
            if (isLine(this, line))
                return getLine(this, line);
        },
        getLineNumber: function (line) {
            return lineNo(line);
        },
        getLineHandleVisualStart: function (line) {
            if (typeof line == "number")
                line = getLine(this, line);
            return visualLine(line);
        },
        lineCount: function () {
            return this.size;
        },
        firstLine: function () {
            return this.first;
        },
        lastLine: function () {
            return this.first + this.size - 1;
        },
        clipPos: function (pos) {
            return clipPos(this, pos);
        },
        getCursor: function (start) {
            var range = this.sel.primary(), pos;
            if (start == null || start == "head")
                pos = range.head;
            else if (start == "anchor")
                pos = range.anchor;
            else if (start == "end" || start == "to" || start === false)
                pos = range.to();
            else
                pos = range.from();
            return pos;
        },
        listSelections: function () {
            return this.sel.ranges;
        },
        somethingSelected: function () {
            return this.sel.somethingSelected();
        },
        setCursor: docMethodOp(function (line, ch, options) {
            setSimpleSelection(this, clipPos(this, typeof line == "number" ? Pos(line, ch || 0) : line), null, options);
        }),
        setSelection: docMethodOp(function (anchor, head, options) {
            setSimpleSelection(this, clipPos(this, anchor), clipPos(this, head || anchor), options);
        }),
        extendSelection: docMethodOp(function (head, other, options) {
            extendSelection(this, clipPos(this, head), other && clipPos(this, other), options);
        }),
        extendSelections: docMethodOp(function (heads, options) {
            extendSelections(this, clipPosArray(this, heads, options));
        }),
        extendSelectionsBy: docMethodOp(function (f, options) {
            extendSelections(this, map(this.sel.ranges, f), options);
        }),
        setSelections: docMethodOp(function (ranges, primary, options) {
            if (!ranges.length)
                return;
            for (var i = 0, out = []; i < ranges.length; i++)
                out[i] = new Range(clipPos(this, ranges[i].anchor),
                        clipPos(this, ranges[i].head));
            if (primary == null)
                primary = Math.min(ranges.length - 1, this.sel.primIndex);
            setSelection(this, normalizeSelection(out, primary), options);
        }),
        addSelection: docMethodOp(function (anchor, head, options) {
            var ranges = this.sel.ranges.slice(0);
            ranges.push(new Range(clipPos(this, anchor), clipPos(this, head || anchor)));
            setSelection(this, normalizeSelection(ranges, ranges.length - 1), options);
        }),
        getSelection: function (lineSep) {
            var ranges = this.sel.ranges, lines;
            for (var i = 0; i < ranges.length; i++) {
                var sel = getBetween(this, ranges[i].from(), ranges[i].to());
                lines = lines ? lines.concat(sel) : sel;
            }
            if (lineSep === false)
                return lines;
            else
                return lines.join(lineSep || "\n");
        },
        getSelections: function (lineSep) {
            var parts = [], ranges = this.sel.ranges;
            for (var i = 0; i < ranges.length; i++) {
                var sel = getBetween(this, ranges[i].from(), ranges[i].to());
                if (lineSep !== false)
                    sel = sel.join(lineSep || "\n");
                parts[i] = sel;
            }
            return parts;
        },
        replaceSelection: function (code, collapse, origin) {
            var dup = [];
            for (var i = 0; i < this.sel.ranges.length; i++)
                dup[i] = code;
            this.replaceSelections(dup, collapse, origin || "+input");
        },
        replaceSelections: docMethodOp(function (code, collapse, origin) {
            var changes = [], sel = this.sel;
            for (var i = 0; i < sel.ranges.length; i++) {
                var range = sel.ranges[i];
                changes[i] = {from: range.from(), to: range.to(), text: splitLines(code[i]), origin: origin};
            }
            var newSel = collapse && collapse != "end" && computeReplacedSel(this, changes, collapse);
            for (var i = changes.length - 1; i >= 0; i--)
                makeChange(this, changes[i]);
            if (newSel)
                setSelectionReplaceHistory(this, newSel);
            else if (this.cm)
                ensureCursorVisible(this.cm);
        }),
        undo: docMethodOp(function () {
            makeChangeFromHistory(this, "undo");
        }),
        redo: docMethodOp(function () {
            makeChangeFromHistory(this, "redo");
        }),
        undoSelection: docMethodOp(function () {
            makeChangeFromHistory(this, "undo", true);
        }),
        redoSelection: docMethodOp(function () {
            makeChangeFromHistory(this, "redo", true);
        }),
        setExtending: function (val) {
            this.extend = val;
        },
        getExtending: function () {
            return this.extend;
        },
        historySize: function () {
            var hist = this.history, done = 0, undone = 0;
            for (var i = 0; i < hist.done.length; i++)
                if (!hist.done[i].ranges)
                    ++done;
            for (var i = 0; i < hist.undone.length; i++)
                if (!hist.undone[i].ranges)
                    ++undone;
            return {undo: done, redo: undone};
        },
        clearHistory: function () {
            this.history = new History(this.history.maxGeneration);
        },
        markClean: function () {
            this.cleanGeneration = this.changeGeneration(true);
        },
        changeGeneration: function (forceSplit) {
            if (forceSplit)
                this.history.lastOp = this.history.lastOrigin = null;
            return this.history.generation;
        },
        isClean: function (gen) {
            return this.history.generation == (gen || this.cleanGeneration);
        },
        getHistory: function () {
            return {done: copyHistoryArray(this.history.done),
                undone: copyHistoryArray(this.history.undone)};
        },
        setHistory: function (histData) {
            var hist = this.history = new History(this.history.maxGeneration);
            hist.done = copyHistoryArray(histData.done.slice(0), null, true);
            hist.undone = copyHistoryArray(histData.undone.slice(0), null, true);
        },
        markText: function (from, to, options) {
            return markText(this, clipPos(this, from), clipPos(this, to), options, "range");
        },
        setBookmark: function (pos, options) {
            var realOpts = {replacedWith: options && (options.nodeType == null ? options.widget : options),
                insertLeft: options && options.insertLeft,
                clearWhenEmpty: false, shared: options && options.shared};
            pos = clipPos(this, pos);
            return markText(this, pos, pos, realOpts, "bookmark");
        },
        findMarksAt: function (pos) {
            pos = clipPos(this, pos);
            var markers = [], spans = getLine(this, pos.line).markedSpans;
            if (spans)
                for (var i = 0; i < spans.length; ++i) {
                    var span = spans[i];
                    if ((span.from == null || span.from <= pos.ch) &&
                            (span.to == null || span.to >= pos.ch))
                        markers.push(span.marker.parent || span.marker);
                }
            return markers;
        },
        findMarks: function (from, to, filter) {
            from = clipPos(this, from);
            to = clipPos(this, to);
            var found = [], lineNo = from.line;
            this.iter(from.line, to.line + 1, function (line) {
                var spans = line.markedSpans;
                if (spans)
                    for (var i = 0; i < spans.length; i++) {
                        var span = spans[i];
                        if (!(lineNo == from.line && from.ch > span.to ||
                                span.from == null && lineNo != from.line ||
                                lineNo == to.line && span.from > to.ch) &&
                                (!filter || filter(span.marker)))
                            found.push(span.marker.parent || span.marker);
                    }
                ++lineNo;
            });
            return found;
        },
        getAllMarks: function () {
            var markers = [];
            this.iter(function (line) {
                var sps = line.markedSpans;
                if (sps)
                    for (var i = 0; i < sps.length; ++i)
                        if (sps[i].from != null)
                            markers.push(sps[i].marker);
            });
            return markers;
        },
        posFromIndex: function (off) {
            var ch, lineNo = this.first;
            this.iter(function (line) {
                var sz = line.text.length + 1;
                if (sz > off) {
                    ch = off;
                    return true;
                }
                off -= sz;
                ++lineNo;
            });
            return clipPos(this, Pos(lineNo, ch));
        },
        indexFromPos: function (coords) {
            coords = clipPos(this, coords);
            var index = coords.ch;
            if (coords.line < this.first || coords.ch < 0)
                return 0;
            this.iter(this.first, coords.line, function (line) {
                index += line.text.length + 1;
            });
            return index;
        },
        copy: function (copyHistory) {
            var doc = new Doc(getLines(this, this.first, this.first + this.size), this.modeOption, this.first);
            doc.scrollTop = this.scrollTop;
            doc.scrollLeft = this.scrollLeft;
            doc.sel = this.sel;
            doc.extend = false;
            if (copyHistory) {
                doc.history.undoDepth = this.history.undoDepth;
                doc.setHistory(this.getHistory());
            }
            return doc;
        },
        linkedDoc: function (options) {
            if (!options)
                options = {};
            var from = this.first, to = this.first + this.size;
            if (options.from != null && options.from > from)
                from = options.from;
            if (options.to != null && options.to < to)
                to = options.to;
            var copy = new Doc(getLines(this, from, to), options.mode || this.modeOption, from);
            if (options.sharedHist)
                copy.history = this.history;
            (this.linked || (this.linked = [])).push({doc: copy, sharedHist: options.sharedHist});
            copy.linked = [{doc: this, isParent: true, sharedHist: options.sharedHist}];
            copySharedMarkers(copy, findSharedMarkers(this));
            return copy;
        },
        unlinkDoc: function (other) {
            if (other instanceof CodeMirror)
                other = other.doc;
            if (this.linked)
                for (var i = 0; i < this.linked.length; ++i) {
                    var link = this.linked[i];
                    if (link.doc != other)
                        continue;
                    this.linked.splice(i, 1);
                    other.unlinkDoc(this);
                    detachSharedMarkers(findSharedMarkers(this));
                    break;
                }
            // If the histories were shared, split them again
            if (other.history == this.history) {
                var splitIds = [other.id];
                linkedDocs(other, function (doc) {
                    splitIds.push(doc.id);
                }, true);
                other.history = new History(null);
                other.history.done = copyHistoryArray(this.history.done, splitIds);
                other.history.undone = copyHistoryArray(this.history.undone, splitIds);
            }
        },
        iterLinkedDocs: function (f) {
            linkedDocs(this, f);
        },
        getMode: function () {
            return this.mode;
        },
        getEditor: function () {
            return this.cm;
        }
    });

    // Public alias.
    Doc.prototype.eachLine = Doc.prototype.iter;

    // Set up methods on CodeMirror's prototype to redirect to the editor's document.
    var dontDelegate = "iter insert remove copy getEditor".split(" ");
    for (var prop in Doc.prototype)
        if (Doc.prototype.hasOwnProperty(prop) && indexOf(dontDelegate, prop) < 0)
            CodeMirror.prototype[prop] = (function (method) {
                return function () {
                    return method.apply(this.doc, arguments);
                };
            })(Doc.prototype[prop]);

    eventMixin(Doc);

    // Call f for all linked documents.
    function linkedDocs(doc, f, sharedHistOnly) {
        function propagate(doc, skip, sharedHist) {
            if (doc.linked)
                for (var i = 0; i < doc.linked.length; ++i) {
                    var rel = doc.linked[i];
                    if (rel.doc == skip)
                        continue;
                    var shared = sharedHist && rel.sharedHist;
                    if (sharedHistOnly && !shared)
                        continue;
                    f(rel.doc, shared);
                    propagate(rel.doc, doc, shared);
                }
        }
        propagate(doc, null, true);
    }

    // Attach a document to an editor.
    function attachDoc(cm, doc) {
        if (doc.cm)
            throw new Error("This document is already in use.");
        cm.doc = doc;
        doc.cm = cm;
        estimateLineHeights(cm);
        loadMode(cm);
        if (!cm.options.lineWrapping)
            findMaxLine(cm);
        cm.options.mode = doc.modeOption;
        regChange(cm);
    }

    // LINE UTILITIES

    // Find the line object corresponding to the given line number.
    function getLine(doc, n) {
        n -= doc.first;
        if (n < 0 || n >= doc.size)
            throw new Error("There is no line " + (n + doc.first) + " in the document.");
        for (var chunk = doc; !chunk.lines; ) {
            for (var i = 0; ; ++i) {
                var child = chunk.children[i], sz = child.chunkSize();
                if (n < sz) {
                    chunk = child;
                    break;
                }
                n -= sz;
            }
        }
        return chunk.lines[n];
    }

    // Get the part of a document between two positions, as an array of
    // strings.
    function getBetween(doc, start, end) {
        var out = [], n = start.line;
        doc.iter(start.line, end.line + 1, function (line) {
            var text = line.text;
            if (n == end.line)
                text = text.slice(0, end.ch);
            if (n == start.line)
                text = text.slice(start.ch);
            out.push(text);
            ++n;
        });
        return out;
    }
    // Get the lines between from and to, as array of strings.
    function getLines(doc, from, to) {
        var out = [];
        doc.iter(from, to, function (line) {
            out.push(line.text);
        });
        return out;
    }

    // Update the height of a line, propagating the height change
    // upwards to parent nodes.
    function updateLineHeight(line, height) {
        var diff = height - line.height;
        if (diff)
            for (var n = line; n; n = n.parent)
                n.height += diff;
    }

    // Given a line object, find its line number by walking up through
    // its parent links.
    function lineNo(line) {
        if (line.parent == null)
            return null;
        var cur = line.parent, no = indexOf(cur.lines, line);
        for (var chunk = cur.parent; chunk; cur = chunk, chunk = chunk.parent) {
            for (var i = 0; ; ++i) {
                if (chunk.children[i] == cur)
                    break;
                no += chunk.children[i].chunkSize();
            }
        }
        return no + cur.first;
    }

    // Find the line at the given vertical position, using the height
    // information in the document tree.
    function lineAtHeight(chunk, h) {
        var n = chunk.first;
        outer: do {
            for (var i = 0; i < chunk.children.length; ++i) {
                var child = chunk.children[i], ch = child.height;
                if (h < ch) {
                    chunk = child;
                    continue outer;
                }
                h -= ch;
                n += child.chunkSize();
            }
            return n;
        } while (!chunk.lines);
        for (var i = 0; i < chunk.lines.length; ++i) {
            var line = chunk.lines[i], lh = line.height;
            if (h < lh)
                break;
            h -= lh;
        }
        return n + i;
    }


    // Find the height above the given line.
    function heightAtLine(lineObj) {
        lineObj = visualLine(lineObj);

        var h = 0, chunk = lineObj.parent;
        for (var i = 0; i < chunk.lines.length; ++i) {
            var line = chunk.lines[i];
            if (line == lineObj)
                break;
            else
                h += line.height;
        }
        for (var p = chunk.parent; p; chunk = p, p = chunk.parent) {
            for (var i = 0; i < p.children.length; ++i) {
                var cur = p.children[i];
                if (cur == chunk)
                    break;
                else
                    h += cur.height;
            }
        }
        return h;
    }

    // Get the bidi ordering for the given line (and cache it). Returns
    // false for lines that are fully left-to-right, and an array of
    // BidiSpan objects otherwise.
    function getOrder(line) {
        var order = line.order;
        if (order == null)
            order = line.order = bidiOrdering(line.text);
        return order;
    }

    // HISTORY

    function History(startGen) {
        // Arrays of change events and selections. Doing something adds an
        // event to done and clears undo. Undoing moves events from done
        // to undone, redoing moves them in the other direction.
        this.done = [];
        this.undone = [];
        this.undoDepth = Infinity;
        // Used to track when changes can be merged into a single undo
        // event
        this.lastModTime = this.lastSelTime = 0;
        this.lastOp = null;
        this.lastOrigin = this.lastSelOrigin = null;
        // Used by the isClean() method
        this.generation = this.maxGeneration = startGen || 1;
    }

    // Create a history change event from an updateDoc-style change
    // object.
    function historyChangeFromChange(doc, change) {
        var histChange = {from: copyPos(change.from), to: changeEnd(change), text: getBetween(doc, change.from, change.to)};
        attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);
        linkedDocs(doc, function (doc) {
            attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);
        }, true);
        return histChange;
    }

    // Pop all selection events off the end of a history array. Stop at
    // a change event.
    function clearSelectionEvents(array) {
        while (array.length) {
            var last = lst(array);
            if (last.ranges)
                array.pop();
            else
                break;
        }
    }

    // Find the top change event in the history. Pop off selection
    // events that are in the way.
    function lastChangeEvent(hist, force) {
        if (force) {
            clearSelectionEvents(hist.done);
            return lst(hist.done);
        } else if (hist.done.length && !lst(hist.done).ranges) {
            return lst(hist.done);
        } else if (hist.done.length > 1 && !hist.done[hist.done.length - 2].ranges) {
            hist.done.pop();
            return lst(hist.done);
        }
    }

    // Register a change in the history. Merges changes that are within
    // a single operation, ore are close together with an origin that
    // allows merging (starting with "+") into a single event.
    function addChangeToHistory(doc, change, selAfter, opId) {
        var hist = doc.history;
        hist.undone.length = 0;
        var time = +new Date, cur;

        if ((hist.lastOp == opId ||
                hist.lastOrigin == change.origin && change.origin &&
                ((change.origin.charAt(0) == "+" && doc.cm && hist.lastModTime > time - doc.cm.options.historyEventDelay) ||
                        change.origin.charAt(0) == "*")) &&
                (cur = lastChangeEvent(hist, hist.lastOp == opId))) {
            // Merge this change into the last event
            var last = lst(cur.changes);
            if (cmp(change.from, change.to) == 0 && cmp(change.from, last.to) == 0) {
                // Optimized case for simple insertion -- don't want to add
                // new changesets for every character typed
                last.to = changeEnd(change);
            } else {
                // Add new sub-event
                cur.changes.push(historyChangeFromChange(doc, change));
            }
        } else {
            // Can not be merged, start a new event.
            var before = lst(hist.done);
            if (!before || !before.ranges)
                pushSelectionToHistory(doc.sel, hist.done);
            cur = {changes: [historyChangeFromChange(doc, change)],
                generation: hist.generation};
            hist.done.push(cur);
            while (hist.done.length > hist.undoDepth) {
                hist.done.shift();
                if (!hist.done[0].ranges)
                    hist.done.shift();
            }
        }
        hist.done.push(selAfter);
        hist.generation = ++hist.maxGeneration;
        hist.lastModTime = hist.lastSelTime = time;
        hist.lastOp = opId;
        hist.lastOrigin = hist.lastSelOrigin = change.origin;

        if (!last)
            signal(doc, "historyAdded");
    }

    function selectionEventCanBeMerged(doc, origin, prev, sel) {
        var ch = origin.charAt(0);
        return ch == "*" ||
                ch == "+" &&
                prev.ranges.length == sel.ranges.length &&
                prev.somethingSelected() == sel.somethingSelected() &&
                new Date - doc.history.lastSelTime <= (doc.cm ? doc.cm.options.historyEventDelay : 500);
    }

    // Called whenever the selection changes, sets the new selection as
    // the pending selection in the history, and pushes the old pending
    // selection into the 'done' array when it was significantly
    // different (in number of selected ranges, emptiness, or time).
    function addSelectionToHistory(doc, sel, opId, options) {
        var hist = doc.history, origin = options && options.origin;

        // A new event is started when the previous origin does not match
        // the current, or the origins don't allow matching. Origins
        // starting with * are always merged, those starting with + are
        // merged when similar and close together in time.
        if (opId == hist.lastOp ||
                (origin && hist.lastSelOrigin == origin &&
                        (hist.lastModTime == hist.lastSelTime && hist.lastOrigin == origin ||
                                selectionEventCanBeMerged(doc, origin, lst(hist.done), sel))))
            hist.done[hist.done.length - 1] = sel;
        else
            pushSelectionToHistory(sel, hist.done);

        hist.lastSelTime = +new Date;
        hist.lastSelOrigin = origin;
        hist.lastOp = opId;
        if (options && options.clearRedo !== false)
            clearSelectionEvents(hist.undone);
    }

    function pushSelectionToHistory(sel, dest) {
        var top = lst(dest);
        if (!(top && top.ranges && top.equals(sel)))
            dest.push(sel);
    }

    // Used to store marked span information in the history.
    function attachLocalSpans(doc, change, from, to) {
        var existing = change["spans_" + doc.id], n = 0;
        doc.iter(Math.max(doc.first, from), Math.min(doc.first + doc.size, to), function (line) {
            if (line.markedSpans)
                (existing || (existing = change["spans_" + doc.id] = {}))[n] = line.markedSpans;
            ++n;
        });
    }

    // When un/re-doing restores text containing marked spans, those
    // that have been explicitly cleared should not be restored.
    function removeClearedSpans(spans) {
        if (!spans)
            return null;
        for (var i = 0, out; i < spans.length; ++i) {
            if (spans[i].marker.explicitlyCleared) {
                if (!out)
                    out = spans.slice(0, i);
            } else if (out)
                out.push(spans[i]);
        }
        return !out ? spans : out.length ? out : null;
    }

    // Retrieve and filter the old marked spans stored in a change event.
    function getOldSpans(doc, change) {
        var found = change["spans_" + doc.id];
        if (!found)
            return null;
        for (var i = 0, nw = []; i < change.text.length; ++i)
            nw.push(removeClearedSpans(found[i]));
        return nw;
    }

    // Used both to provide a JSON-safe object in .getHistory, and, when
    // detaching a document, to split the history in two
    function copyHistoryArray(events, newGroup, instantiateSel) {
        for (var i = 0, copy = []; i < events.length; ++i) {
            var event = events[i];
            if (event.ranges) {
                copy.push(instantiateSel ? Selection.prototype.deepCopy.call(event) : event);
                continue;
            }
            var changes = event.changes, newChanges = [];
            copy.push({changes: newChanges});
            for (var j = 0; j < changes.length; ++j) {
                var change = changes[j], m;
                newChanges.push({from: change.from, to: change.to, text: change.text});
                if (newGroup)
                    for (var prop in change)
                        if (m = prop.match(/^spans_(\d+)$/)) {
                            if (indexOf(newGroup, Number(m[1])) > -1) {
                                lst(newChanges)[prop] = change[prop];
                                delete change[prop];
                            }
                        }
            }
        }
        return copy;
    }

    // Rebasing/resetting history to deal with externally-sourced changes

    function rebaseHistSelSingle(pos, from, to, diff) {
        if (to < pos.line) {
            pos.line += diff;
        } else if (from < pos.line) {
            pos.line = from;
            pos.ch = 0;
        }
    }

    // Tries to rebase an array of history events given a change in the
    // document. If the change touches the same lines as the event, the
    // event, and everything 'behind' it, is discarded. If the change is
    // before the event, the event's positions are updated. Uses a
    // copy-on-write scheme for the positions, to avoid having to
    // reallocate them all on every rebase, but also avoid problems with
    // shared position objects being unsafely updated.
    function rebaseHistArray(array, from, to, diff) {
        for (var i = 0; i < array.length; ++i) {
            var sub = array[i], ok = true;
            if (sub.ranges) {
                if (!sub.copied) {
                    sub = array[i] = sub.deepCopy();
                    sub.copied = true;
                }
                for (var j = 0; j < sub.ranges.length; j++) {
                    rebaseHistSelSingle(sub.ranges[j].anchor, from, to, diff);
                    rebaseHistSelSingle(sub.ranges[j].head, from, to, diff);
                }
                continue;
            }
            for (var j = 0; j < sub.changes.length; ++j) {
                var cur = sub.changes[j];
                if (to < cur.from.line) {
                    cur.from = Pos(cur.from.line + diff, cur.from.ch);
                    cur.to = Pos(cur.to.line + diff, cur.to.ch);
                } else if (from <= cur.to.line) {
                    ok = false;
                    break;
                }
            }
            if (!ok) {
                array.splice(0, i + 1);
                i = 0;
            }
        }
    }

    function rebaseHist(hist, change) {
        var from = change.from.line, to = change.to.line, diff = change.text.length - (to - from) - 1;
        rebaseHistArray(hist.done, from, to, diff);
        rebaseHistArray(hist.undone, from, to, diff);
    }

    // EVENT UTILITIES

    // Due to the fact that we still support jurassic IE versions, some
    // compatibility wrappers are needed.

    var e_preventDefault = CodeMirror.e_preventDefault = function (e) {
        if (e.preventDefault)
            e.preventDefault();
        else
            e.returnValue = false;
    };
    var e_stopPropagation = CodeMirror.e_stopPropagation = function (e) {
        if (e.stopPropagation)
            e.stopPropagation();
        else
            e.cancelBubble = true;
    };
    function e_defaultPrevented(e) {
        return e.defaultPrevented != null ? e.defaultPrevented : e.returnValue == false;
    }
    var e_stop = CodeMirror.e_stop = function (e) {
        e_preventDefault(e);
        e_stopPropagation(e);
    };

    function e_target(e) {
        return e.target || e.srcElement;
    }
    function e_button(e) {
        var b = e.which;
        if (b == null) {
            if (e.button & 1)
                b = 1;
            else if (e.button & 2)
                b = 3;
            else if (e.button & 4)
                b = 2;
        }
        if (mac && e.ctrlKey && b == 1)
            b = 3;
        return b;
    }

    // EVENT HANDLING

    // Lightweight event framework. on/off also work on DOM nodes,
    // registering native DOM handlers.

    var on = CodeMirror.on = function (emitter, type, f) {
        if (emitter.addEventListener)
            emitter.addEventListener(type, f, false);
        else if (emitter.attachEvent)
            emitter.attachEvent("on" + type, f);
        else {
            var map = emitter._handlers || (emitter._handlers = {});
            var arr = map[type] || (map[type] = []);
            arr.push(f);
        }
    };

    var off = CodeMirror.off = function (emitter, type, f) {
        if (emitter.removeEventListener)
            emitter.removeEventListener(type, f, false);
        else if (emitter.detachEvent)
            emitter.detachEvent("on" + type, f);
        else {
            var arr = emitter._handlers && emitter._handlers[type];
            if (!arr)
                return;
            for (var i = 0; i < arr.length; ++i)
                if (arr[i] == f) {
                    arr.splice(i, 1);
                    break;
                }
        }
    };

    var signal = CodeMirror.signal = function (emitter, type /*, values...*/) {
        var arr = emitter._handlers && emitter._handlers[type];
        if (!arr)
            return;
        var args = Array.prototype.slice.call(arguments, 2);
        for (var i = 0; i < arr.length; ++i)
            arr[i].apply(null, args);
    };

    // Often, we want to signal events at a point where we are in the
    // middle of some work, but don't want the handler to start calling
    // other methods on the editor, which might be in an inconsistent
    // state or simply not expect any other events to happen.
    // signalLater looks whether there are any handlers, and schedules
    // them to be executed when the last operation ends, or, if no
    // operation is active, when a timeout fires.
    var delayedCallbacks, delayedCallbackDepth = 0;
    function signalLater(emitter, type /*, values...*/) {
        var arr = emitter._handlers && emitter._handlers[type];
        if (!arr)
            return;
        var args = Array.prototype.slice.call(arguments, 2);
        if (!delayedCallbacks) {
            ++delayedCallbackDepth;
            delayedCallbacks = [];
            setTimeout(fireDelayed, 0);
        }
        function bnd(f) {
            return function () {
                f.apply(null, args);
            };
        }
        ;
        for (var i = 0; i < arr.length; ++i)
            delayedCallbacks.push(bnd(arr[i]));
    }

    function fireDelayed() {
        --delayedCallbackDepth;
        var delayed = delayedCallbacks;
        delayedCallbacks = null;
        for (var i = 0; i < delayed.length; ++i)
            delayed[i]();
    }

    // The DOM events that CodeMirror handles can be overridden by
    // registering a (non-DOM) handler on the editor for the event name,
    // and preventDefault-ing the event in that handler.
    function signalDOMEvent(cm, e, override) {
        signal(cm, override || e.type, cm, e);
        return e_defaultPrevented(e) || e.codemirrorIgnore;
    }

    function signalCursorActivity(cm) {
        var arr = cm._handlers && cm._handlers.cursorActivity;
        if (!arr)
            return;
        var set = cm.curOp.cursorActivityHandlers || (cm.curOp.cursorActivityHandlers = []);
        for (var i = 0; i < arr.length; ++i)
            if (indexOf(set, arr[i]) == -1)
                set.push(arr[i]);
    }

    function hasHandler(emitter, type) {
        var arr = emitter._handlers && emitter._handlers[type];
        return arr && arr.length > 0;
    }

    // Add on and off methods to a constructor's prototype, to make
    // registering events on such objects more convenient.
    function eventMixin(ctor) {
        ctor.prototype.on = function (type, f) {
            on(this, type, f);
        };
        ctor.prototype.off = function (type, f) {
            off(this, type, f);
        };
    }

    // MISC UTILITIES

    // Number of pixels added to scroller and sizer to hide scrollbar
    var scrollerCutOff = 30;

    // Returned or thrown by various protocols to signal 'I'm not
    // handling this'.
    var Pass = CodeMirror.Pass = {toString: function () {
            return "CodeMirror.Pass";
        }};

    // Reused option objects for setSelection & friends
    var sel_dontScroll = {scroll: false}, sel_mouse = {origin: "*mouse"}, sel_move = {origin: "+move"};

    function Delayed() {
        this.id = null;
    }
    Delayed.prototype.set = function (ms, f) {
        clearTimeout(this.id);
        this.id = setTimeout(f, ms);
    };

    // Counts the column offset in a string, taking tabs into account.
    // Used mostly to find indentation.
    var countColumn = CodeMirror.countColumn = function (string, end, tabSize, startIndex, startValue) {
        if (end == null) {
            end = string.search(/[^\s\u00a0]/);
            if (end == -1)
                end = string.length;
        }
        for (var i = startIndex || 0, n = startValue || 0; ; ) {
            var nextTab = string.indexOf("\t", i);
            if (nextTab < 0 || nextTab >= end)
                return n + (end - i);
            n += nextTab - i;
            n += tabSize - (n % tabSize);
            i = nextTab + 1;
        }
    };

    // The inverse of countColumn -- find the offset that corresponds to
    // a particular column.
    function findColumn(string, goal, tabSize) {
        for (var pos = 0, col = 0; ; ) {
            var nextTab = string.indexOf("\t", pos);
            if (nextTab == -1)
                nextTab = string.length;
            var skipped = nextTab - pos;
            if (nextTab == string.length || col + skipped >= goal)
                return pos + Math.min(skipped, goal - col);
            col += nextTab - pos;
            col += tabSize - (col % tabSize);
            pos = nextTab + 1;
            if (col >= goal)
                return pos;
        }
    }

    var spaceStrs = [""];
    function spaceStr(n) {
        while (spaceStrs.length <= n)
            spaceStrs.push(lst(spaceStrs) + " ");
        return spaceStrs[n];
    }

    function lst(arr) {
        return arr[arr.length - 1];
    }

    var selectInput = function (node) {
        node.select();
    };
    if (ios) // Mobile Safari apparently has a bug where select() is broken.
        selectInput = function (node) {
            node.selectionStart = 0;
            node.selectionEnd = node.value.length;
        };
    else if (ie) // Suppress mysterious IE10 errors
        selectInput = function (node) {
            try {
                node.select();
            } catch (_e) {
            }
        };

    function indexOf(array, elt) {
        for (var i = 0; i < array.length; ++i)
            if (array[i] == elt)
                return i;
        return -1;
    }
    if ([].indexOf)
        indexOf = function (array, elt) {
            return array.indexOf(elt);
        };
    function map(array, f) {
        var out = [];
        for (var i = 0; i < array.length; i++)
            out[i] = f(array[i], i);
        return out;
    }
    if ([].map)
        map = function (array, f) {
            return array.map(f);
        };

    function createObj(base, props) {
        var inst;
        if (Object.create) {
            inst = Object.create(base);
        } else {
            var ctor = function () {};
            ctor.prototype = base;
            inst = new ctor();
        }
        if (props)
            copyObj(props, inst);
        return inst;
    }
    ;

    function copyObj(obj, target, overwrite) {
        if (!target)
            target = {};
        for (var prop in obj)
            if (obj.hasOwnProperty(prop) && (overwrite !== false || !target.hasOwnProperty(prop)))
                target[prop] = obj[prop];
        return target;
    }

    function bind(f) {
        var args = Array.prototype.slice.call(arguments, 1);
        return function () {
            return f.apply(null, args);
        };
    }

    var nonASCIISingleCaseWordChar = /[\u00df\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
    var isWordChar = CodeMirror.isWordChar = function (ch) {
        return /\w/.test(ch) || ch > "\x80" &&
                (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch));
    };

    function isEmpty(obj) {
        for (var n in obj)
            if (obj.hasOwnProperty(n) && obj[n])
                return false;
        return true;
    }

    // Extending unicode characters. A series of a non-extending char +
    // any number of extending chars is treated as a single unit as far
    // as editing and measuring is concerned. This is not fully correct,
    // since some scripts/fonts/browsers also treat other configurations
    // of code points as a group.
    var extendingChars = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065e\u0670\u06d6-\u06dc\u06de-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0900-\u0902\u093c\u0941-\u0948\u094d\u0951-\u0955\u0962\u0963\u0981\u09bc\u09be\u09c1-\u09c4\u09cd\u09d7\u09e2\u09e3\u0a01\u0a02\u0a3c\u0a41\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a70\u0a71\u0a75\u0a81\u0a82\u0abc\u0ac1-\u0ac5\u0ac7\u0ac8\u0acd\u0ae2\u0ae3\u0b01\u0b3c\u0b3e\u0b3f\u0b41-\u0b44\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b82\u0bbe\u0bc0\u0bcd\u0bd7\u0c3e-\u0c40\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0cbc\u0cbf\u0cc2\u0cc6\u0ccc\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0d3e\u0d41-\u0d44\u0d4d\u0d57\u0d62\u0d63\u0dca\u0dcf\u0dd2-\u0dd4\u0dd6\u0ddf\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0f18\u0f19\u0f35\u0f37\u0f39\u0f71-\u0f7e\u0f80-\u0f84\u0f86\u0f87\u0f90-\u0f97\u0f99-\u0fbc\u0fc6\u102d-\u1030\u1032-\u1037\u1039\u103a\u103d\u103e\u1058\u1059\u105e-\u1060\u1071-\u1074\u1082\u1085\u1086\u108d\u109d\u135f\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b7-\u17bd\u17c6\u17c9-\u17d3\u17dd\u180b-\u180d\u18a9\u1920-\u1922\u1927\u1928\u1932\u1939-\u193b\u1a17\u1a18\u1a56\u1a58-\u1a5e\u1a60\u1a62\u1a65-\u1a6c\u1a73-\u1a7c\u1a7f\u1b00-\u1b03\u1b34\u1b36-\u1b3a\u1b3c\u1b42\u1b6b-\u1b73\u1b80\u1b81\u1ba2-\u1ba5\u1ba8\u1ba9\u1c2c-\u1c33\u1c36\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce0\u1ce2-\u1ce8\u1ced\u1dc0-\u1de6\u1dfd-\u1dff\u200c\u200d\u20d0-\u20f0\u2cef-\u2cf1\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua66f-\ua672\ua67c\ua67d\ua6f0\ua6f1\ua802\ua806\ua80b\ua825\ua826\ua8c4\ua8e0-\ua8f1\ua926-\ua92d\ua947-\ua951\ua980-\ua982\ua9b3\ua9b6-\ua9b9\ua9bc\uaa29-\uaa2e\uaa31\uaa32\uaa35\uaa36\uaa43\uaa4c\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uabe5\uabe8\uabed\udc00-\udfff\ufb1e\ufe00-\ufe0f\ufe20-\ufe26\uff9e\uff9f]/;
    function isExtendingChar(ch) {
        return ch.charCodeAt(0) >= 768 && extendingChars.test(ch);
    }

    // DOM UTILITIES

    function elt(tag, content, className, style) {
        var e = document.createElement(tag);
        if (className)
            e.className = className;
        if (style)
            e.style.cssText = style;
        if (typeof content == "string")
            e.appendChild(document.createTextNode(content));
        else if (content)
            for (var i = 0; i < content.length; ++i)
                e.appendChild(content[i]);
        return e;
    }

    var range;
    if (document.createRange)
        range = function (node, start, end) {
            var r = document.createRange();
            r.setEnd(node, end);
            r.setStart(node, start);
            return r;
        };
    else
        range = function (node, start, end) {
            var r = document.body.createTextRange();
            r.moveToElementText(node.parentNode);
            r.collapse(true);
            r.moveEnd("character", end);
            r.moveStart("character", start);
            return r;
        };

    function removeChildren(e) {
        for (var count = e.childNodes.length; count > 0; --count)
            e.removeChild(e.firstChild);
        return e;
    }

    function removeChildrenAndAdd(parent, e) {
        return removeChildren(parent).appendChild(e);
    }

    function contains(parent, child) {
        if (parent.contains)
            return parent.contains(child);
        while (child = child.parentNode)
            if (child == parent)
                return true;
    }

    function activeElt() {
        return document.activeElement;
    }
    // Older versions of IE throws unspecified error when touching
    // document.activeElement in some cases (during loading, in iframe)
    if (ie_upto10)
        activeElt = function () {
            try {
                return document.activeElement;
            } catch (e) {
                return document.body;
            }
        };

    function classTest(cls) {
        return new RegExp("\\b" + cls + "\\b\\s*");
    }
    function rmClass(node, cls) {
        var test = classTest(cls);
        if (test.test(node.className))
            node.className = node.className.replace(test, "");
    }
    function addClass(node, cls) {
        if (!classTest(cls).test(node.className))
            node.className += " " + cls;
    }
    function joinClasses(a, b) {
        var as = a.split(" ");
        for (var i = 0; i < as.length; i++)
            if (as[i] && !classTest(as[i]).test(b))
                b += " " + as[i];
        return b;
    }

    // FEATURE DETECTION

    // Detect drag-and-drop
    var dragAndDrop = function () {
        // There is *some* kind of drag-and-drop support in IE6-8, but I
        // couldn't get it to work yet.
        if (ie_upto8)
            return false;
        var div = elt('div');
        return "draggable" in div || "dragDrop" in div;
    }();

    var knownScrollbarWidth;
    function scrollbarWidth(measure) {
        if (knownScrollbarWidth != null)
            return knownScrollbarWidth;
        var test = elt("div", null, null, "width: 50px; height: 50px; overflow-x: scroll");
        removeChildrenAndAdd(measure, test);
        if (test.offsetWidth)
            knownScrollbarWidth = test.offsetHeight - test.clientHeight;
        return knownScrollbarWidth || 0;
    }

    var zwspSupported;
    function zeroWidthElement(measure) {
        if (zwspSupported == null) {
            var test = elt("span", "\u200b");
            removeChildrenAndAdd(measure, elt("span", [test, document.createTextNode("x")]));
            if (measure.firstChild.offsetHeight != 0)
                zwspSupported = test.offsetWidth <= 1 && test.offsetHeight > 2 && !ie_upto7;
        }
        if (zwspSupported)
            return elt("span", "\u200b");
        else
            return elt("span", "\u00a0", null, "display: inline-block; width: 1px; margin-right: -1px");
    }

    // Feature-detect IE's crummy client rect reporting for bidi text
    var badBidiRects;
    function hasBadBidiRects(measure) {
        if (badBidiRects != null)
            return badBidiRects;
        var txt = removeChildrenAndAdd(measure, document.createTextNode("A\u062eA"));
        var r0 = range(txt, 0, 1).getBoundingClientRect();
        if (r0.left == r0.right)
            return false;
        var r1 = range(txt, 1, 2).getBoundingClientRect();
        return badBidiRects = (r1.right - r0.right < 3);
    }

    // See if "".split is the broken IE version, if so, provide an
    // alternative way to split lines.
    var splitLines = CodeMirror.splitLines = "\n\nb".split(/\n/).length != 3 ? function (string) {
        var pos = 0, result = [], l = string.length;
        while (pos <= l) {
            var nl = string.indexOf("\n", pos);
            if (nl == -1)
                nl = string.length;
            var line = string.slice(pos, string.charAt(nl - 1) == "\r" ? nl - 1 : nl);
            var rt = line.indexOf("\r");
            if (rt != -1) {
                result.push(line.slice(0, rt));
                pos += rt + 1;
            } else {
                result.push(line);
                pos = nl + 1;
            }
        }
        return result;
    } : function (string) {
        return string.split(/\r\n?|\n/);
    };

    var hasSelection = window.getSelection ? function (te) {
        try {
            return te.selectionStart != te.selectionEnd;
        } catch (e) {
            return false;
        }
    } : function (te) {
        try {
            var range = te.ownerDocument.selection.createRange();
        } catch (e) {
        }
        if (!range || range.parentElement() != te)
            return false;
        return range.compareEndPoints("StartToEnd", range) != 0;
    };

    var hasCopyEvent = (function () {
        var e = elt("div");
        if ("oncopy" in e)
            return true;
        e.setAttribute("oncopy", "return;");
        return typeof e.oncopy == "function";
    })();

    // KEY NAMES

    var keyNames = {3: "Enter", 8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt",
        19: "Pause", 20: "CapsLock", 27: "Esc", 32: "Space", 33: "PageUp", 34: "PageDown", 35: "End",
        36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down", 44: "PrintScrn", 45: "Insert",
        46: "Delete", 59: ";", 61: "=", 91: "Mod", 92: "Mod", 93: "Mod", 107: "=", 109: "-", 127: "Delete",
        173: "-", 186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\",
        221: "]", 222: "'", 63232: "Up", 63233: "Down", 63234: "Left", 63235: "Right", 63272: "Delete",
        63273: "Home", 63275: "End", 63276: "PageUp", 63277: "PageDown", 63302: "Insert"};
    CodeMirror.keyNames = keyNames;
    (function () {
        // Number keys
        for (var i = 0; i < 10; i++)
            keyNames[i + 48] = keyNames[i + 96] = String(i);
        // Alphabetic keys
        for (var i = 65; i <= 90; i++)
            keyNames[i] = String.fromCharCode(i);
        // Function keys
        for (var i = 1; i <= 12; i++)
            keyNames[i + 111] = keyNames[i + 63235] = "F" + i;
    })();

    // BIDI HELPERS

    function iterateBidiSections(order, from, to, f) {
        if (!order)
            return f(from, to, "ltr");
        var found = false;
        for (var i = 0; i < order.length; ++i) {
            var part = order[i];
            if (part.from < to && part.to > from || from == to && part.to == from) {
                f(Math.max(part.from, from), Math.min(part.to, to), part.level == 1 ? "rtl" : "ltr");
                found = true;
            }
        }
        if (!found)
            f(from, to, "ltr");
    }

    function bidiLeft(part) {
        return part.level % 2 ? part.to : part.from;
    }
    function bidiRight(part) {
        return part.level % 2 ? part.from : part.to;
    }

    function lineLeft(line) {
        var order = getOrder(line);
        return order ? bidiLeft(order[0]) : 0;
    }
    function lineRight(line) {
        var order = getOrder(line);
        if (!order)
            return line.text.length;
        return bidiRight(lst(order));
    }

    function lineStart(cm, lineN) {
        var line = getLine(cm.doc, lineN);
        var visual = visualLine(line);
        if (visual != line)
            lineN = lineNo(visual);
        var order = getOrder(visual);
        var ch = !order ? 0 : order[0].level % 2 ? lineRight(visual) : lineLeft(visual);
        return Pos(lineN, ch);
    }
    function lineEnd(cm, lineN) {
        var merged, line = getLine(cm.doc, lineN);
        while (merged = collapsedSpanAtEnd(line)) {
            line = merged.find(1, true).line;
            lineN = null;
        }
        var order = getOrder(line);
        var ch = !order ? line.text.length : order[0].level % 2 ? lineLeft(line) : lineRight(line);
        return Pos(lineN == null ? lineNo(line) : lineN, ch);
    }

    function compareBidiLevel(order, a, b) {
        var linedir = order[0].level;
        if (a == linedir)
            return true;
        if (b == linedir)
            return false;
        return a < b;
    }
    var bidiOther;
    function getBidiPartAt(order, pos) {
        bidiOther = null;
        for (var i = 0, found; i < order.length; ++i) {
            var cur = order[i];
            if (cur.from < pos && cur.to > pos)
                return i;
            if ((cur.from == pos || cur.to == pos)) {
                if (found == null) {
                    found = i;
                } else if (compareBidiLevel(order, cur.level, order[found].level)) {
                    if (cur.from != cur.to)
                        bidiOther = found;
                    return i;
                } else {
                    if (cur.from != cur.to)
                        bidiOther = i;
                    return found;
                }
            }
        }
        return found;
    }

    function moveInLine(line, pos, dir, byUnit) {
        if (!byUnit)
            return pos + dir;
        do
            pos += dir;
        while (pos > 0 && isExtendingChar(line.text.charAt(pos)));
        return pos;
    }

    // This is needed in order to move 'visually' through bi-directional
    // text -- i.e., pressing left should make the cursor go left, even
    // when in RTL text. The tricky part is the 'jumps', where RTL and
    // LTR text touch each other. This often requires the cursor offset
    // to move more than one unit, in order to visually move one unit.
    function moveVisually(line, start, dir, byUnit) {
        var bidi = getOrder(line);
        if (!bidi)
            return moveLogically(line, start, dir, byUnit);
        var pos = getBidiPartAt(bidi, start), part = bidi[pos];
        var target = moveInLine(line, start, part.level % 2 ? -dir : dir, byUnit);

        for (; ; ) {
            if (target > part.from && target < part.to)
                return target;
            if (target == part.from || target == part.to) {
                if (getBidiPartAt(bidi, target) == pos)
                    return target;
                part = bidi[pos += dir];
                return (dir > 0) == part.level % 2 ? part.to : part.from;
            } else {
                part = bidi[pos += dir];
                if (!part)
                    return null;
                if ((dir > 0) == part.level % 2)
                    target = moveInLine(line, part.to, -1, byUnit);
                else
                    target = moveInLine(line, part.from, 1, byUnit);
            }
        }
    }

    function moveLogically(line, start, dir, byUnit) {
        var target = start + dir;
        if (byUnit)
            while (target > 0 && isExtendingChar(line.text.charAt(target)))
                target += dir;
        return target < 0 || target > line.text.length ? null : target;
    }

    // Bidirectional ordering algorithm
    // See http://unicode.org/reports/tr9/tr9-13.html for the algorithm
    // that this (partially) implements.

    // One-char codes used for character types:
    // L (L):   Left-to-Right
    // R (R):   Right-to-Left
    // r (AL):  Right-to-Left Arabic
    // 1 (EN):  European Number
    // + (ES):  European Number Separator
    // % (ET):  European Number Terminator
    // n (AN):  Arabic Number
    // , (CS):  Common Number Separator
    // m (NSM): Non-Spacing Mark
    // b (BN):  Boundary Neutral
    // s (B):   Paragraph Separator
    // t (S):   Segment Separator
    // w (WS):  Whitespace
    // N (ON):  Other Neutrals

    // Returns null if characters are ordered as they appear
    // (left-to-right), or an array of sections ({from, to, level}
    // objects) in the order in which they occur visually.
    var bidiOrdering = (function () {
        // Character types for codepoints 0 to 0xff
        var lowTypes = "bbbbbbbbbtstwsbbbbbbbbbbbbbbssstwNN%%%NNNNNN,N,N1111111111NNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNbbbbbbsbbbbbbbbbbbbbbbbbbbbbbbbbb,N%%%%NNNNLNNNNN%%11NLNNN1LNNNNNLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLN";
        // Character types for codepoints 0x600 to 0x6ff
        var arabicTypes = "rrrrrrrrrrrr,rNNmmmmmmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmrrrrrrrnnnnnnnnnn%nnrrrmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmmmmmmNmmmm";
        function charType(code) {
            if (code <= 0xf7)
                return lowTypes.charAt(code);
            else if (0x590 <= code && code <= 0x5f4)
                return "R";
            else if (0x600 <= code && code <= 0x6ed)
                return arabicTypes.charAt(code - 0x600);
            else if (0x6ee <= code && code <= 0x8ac)
                return "r";
            else if (0x2000 <= code && code <= 0x200b)
                return "w";
            else if (code == 0x200c)
                return "b";
            else
                return "L";
        }

        var bidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac]/;
        var isNeutral = /[stwN]/, isStrong = /[LRr]/, countsAsLeft = /[Lb1n]/, countsAsNum = /[1n]/;
        // Browsers seem to always treat the boundaries of block elements as being L.
        var outerType = "L";

        function BidiSpan(level, from, to) {
            this.level = level;
            this.from = from;
            this.to = to;
        }

        return function (str) {
            if (!bidiRE.test(str))
                return false;
            var len = str.length, types = [];
            for (var i = 0, type; i < len; ++i)
                types.push(type = charType(str.charCodeAt(i)));

            // W1. Examine each non-spacing mark (NSM) in the level run, and
            // change the type of the NSM to the type of the previous
            // character. If the NSM is at the start of the level run, it will
            // get the type of sor.
            for (var i = 0, prev = outerType; i < len; ++i) {
                var type = types[i];
                if (type == "m")
                    types[i] = prev;
                else
                    prev = type;
            }

            // W2. Search backwards from each instance of a European number
            // until the first strong type (R, L, AL, or sor) is found. If an
            // AL is found, change the type of the European number to Arabic
            // number.
            // W3. Change all ALs to R.
            for (var i = 0, cur = outerType; i < len; ++i) {
                var type = types[i];
                if (type == "1" && cur == "r")
                    types[i] = "n";
                else if (isStrong.test(type)) {
                    cur = type;
                    if (type == "r")
                        types[i] = "R";
                }
            }

            // W4. A single European separator between two European numbers
            // changes to a European number. A single common separator between
            // two numbers of the same type changes to that type.
            for (var i = 1, prev = types[0]; i < len - 1; ++i) {
                var type = types[i];
                if (type == "+" && prev == "1" && types[i + 1] == "1")
                    types[i] = "1";
                else if (type == "," && prev == types[i + 1] &&
                        (prev == "1" || prev == "n"))
                    types[i] = prev;
                prev = type;
            }

            // W5. A sequence of European terminators adjacent to European
            // numbers changes to all European numbers.
            // W6. Otherwise, separators and terminators change to Other
            // Neutral.
            for (var i = 0; i < len; ++i) {
                var type = types[i];
                if (type == ",")
                    types[i] = "N";
                else if (type == "%") {
                    for (var end = i + 1; end < len && types[end] == "%"; ++end) {
                    }
                    var replace = (i && types[i - 1] == "!") || (end < len && types[end] == "1") ? "1" : "N";
                    for (var j = i; j < end; ++j)
                        types[j] = replace;
                    i = end - 1;
                }
            }

            // W7. Search backwards from each instance of a European number
            // until the first strong type (R, L, or sor) is found. If an L is
            // found, then change the type of the European number to L.
            for (var i = 0, cur = outerType; i < len; ++i) {
                var type = types[i];
                if (cur == "L" && type == "1")
                    types[i] = "L";
                else if (isStrong.test(type))
                    cur = type;
            }

            // N1. A sequence of neutrals takes the direction of the
            // surrounding strong text if the text on both sides has the same
            // direction. European and Arabic numbers act as if they were R in
            // terms of their influence on neutrals. Start-of-level-run (sor)
            // and end-of-level-run (eor) are used at level run boundaries.
            // N2. Any remaining neutrals take the embedding direction.
            for (var i = 0; i < len; ++i) {
                if (isNeutral.test(types[i])) {
                    for (var end = i + 1; end < len && isNeutral.test(types[end]); ++end) {
                    }
                    var before = (i ? types[i - 1] : outerType) == "L";
                    var after = (end < len ? types[end] : outerType) == "L";
                    var replace = before || after ? "L" : "R";
                    for (var j = i; j < end; ++j)
                        types[j] = replace;
                    i = end - 1;
                }
            }

            // Here we depart from the documented algorithm, in order to avoid
            // building up an actual levels array. Since there are only three
            // levels (0, 1, 2) in an implementation that doesn't take
            // explicit embedding into account, we can build up the order on
            // the fly, without following the level-based algorithm.
            var order = [], m;
            for (var i = 0; i < len; ) {
                if (countsAsLeft.test(types[i])) {
                    var start = i;
                    for (++i; i < len && countsAsLeft.test(types[i]); ++i) {
                    }
                    order.push(new BidiSpan(0, start, i));
                } else {
                    var pos = i, at = order.length;
                    for (++i; i < len && types[i] != "L"; ++i) {
                    }
                    for (var j = pos; j < i; ) {
                        if (countsAsNum.test(types[j])) {
                            if (pos < j)
                                order.splice(at, 0, new BidiSpan(1, pos, j));
                            var nstart = j;
                            for (++j; j < i && countsAsNum.test(types[j]); ++j) {
                            }
                            order.splice(at, 0, new BidiSpan(2, nstart, j));
                            pos = j;
                        } else
                            ++j;
                    }
                    if (pos < i)
                        order.splice(at, 0, new BidiSpan(1, pos, i));
                }
            }
            if (order[0].level == 1 && (m = str.match(/^\s+/))) {
                order[0].from = m[0].length;
                order.unshift(new BidiSpan(0, 0, m[0].length));
            }
            if (lst(order).level == 1 && (m = str.match(/\s+$/))) {
                lst(order).to -= m[0].length;
                order.push(new BidiSpan(0, len - m[0].length, len));
            }
            if (order[0].level != lst(order).level)
                order.push(new BidiSpan(order[0].level, len, len));

            return order;
        };
    })();

    // THE END

    CodeMirror.version = "4.1.0";

    return CodeMirror;
});
;(function () {

    CodeMirror.extendMode("css", {
        commentStart: "/*",
        commentEnd: "*/",
        newlineAfterToken: function (type, content) {
            return /^[;{}]$/.test(content);
        }
    });

    CodeMirror.extendMode("javascript", {
        commentStart: "/*",
        commentEnd: "*/",
        // FIXME semicolons inside of for
        newlineAfterToken: function (type, content, textAfter, state) {
            if (this.jsonMode) {
                return /^[\[,{]$/.test(content) || /^}/.test(textAfter);
            } else {
                if (content == ";" && state.lexical && state.lexical.type == ")")
                    return false;
                return /^[;{}]$/.test(content) && !/^;/.test(textAfter);
            }
        }
    });

    CodeMirror.extendMode("xml", {
        commentStart: "<!--",
        commentEnd: "-->",
        newlineAfterToken: function (type, content, textAfter) {
            return type == "tag" && />$/.test(content) || /^</.test(textAfter);
        }
    });

    // Comment/uncomment the specified range
    CodeMirror.defineExtension("commentRange", function (isComment, from, to) {
        var cm = this, curMode = CodeMirror.innerMode(cm.getMode(), cm.getTokenAt(from).state).mode;
        cm.operation(function () {
            if (isComment) { // Comment range
                cm.replaceRange(curMode.commentEnd, to);
                cm.replaceRange(curMode.commentStart, from);
                if (from.line == to.line && from.ch == to.ch) // An empty comment inserted - put cursor inside
                    cm.setCursor(from.line, from.ch + curMode.commentStart.length);
            } else { // Uncomment range
                var selText = cm.getRange(from, to);
                var startIndex = selText.indexOf(curMode.commentStart);
                var endIndex = selText.lastIndexOf(curMode.commentEnd);
                if (startIndex > -1 && endIndex > -1 && endIndex > startIndex) {
                    // Take string till comment start
                    selText = selText.substr(0, startIndex)
                            // From comment start till comment end
                            + selText.substring(startIndex + curMode.commentStart.length, endIndex)
                            // From comment end till string end
                            + selText.substr(endIndex + curMode.commentEnd.length);
                }
                cm.replaceRange(selText, from, to);
            }
        });
    });

    // Applies automatic mode-aware indentation to the specified range
    CodeMirror.defineExtension("autoIndentRange", function (from, to) {
        var cmInstance = this;
        this.operation(function () {
            for (var i = from.line; i <= to.line; i++) {
                cmInstance.indentLine(i, "smart");
            }
        });
    });

    // Applies automatic formatting to the specified range
    CodeMirror.defineExtension("autoFormatRange", function (from, to) {
        var cm = this;
        var outer = cm.getMode(), text = cm.getRange(from, to).split("\n");
        var state = CodeMirror.copyState(outer, cm.getTokenAt(from).state);
        var tabSize = cm.getOption("tabSize");

        var out = "", lines = 0, atSol = from.ch == 0;
        function newline() {
            out += "\n";
            atSol = true;
            ++lines;
        }

        for (var i = 0; i < text.length; ++i) {
            var stream = new CodeMirror.StringStream(text[i], tabSize);
            while (!stream.eol()) {
                var inner = CodeMirror.innerMode(outer, state);
                var style = outer.token(stream, state), cur = stream.current();
                stream.start = stream.pos;
                if (!atSol || /\S/.test(cur)) {
                    out += cur;
                    atSol = false;
                }
                if (!atSol && inner.mode.newlineAfterToken &&
                        inner.mode.newlineAfterToken(style, cur, stream.string.slice(stream.pos) || text[i + 1] || "", inner.state))
                    newline();
            }
            if (!stream.pos && outer.blankLine)
                outer.blankLine(state);
            if (!atSol)
                newline();
        }

        cm.operation(function () {
            cm.replaceRange(out, from, to);
            for (var cur = from.line + 1, end = from.line + lines; cur <= end; ++cur)
                cm.indentLine(cur, "smart");
            cm.setSelection(from, cm.getCursor(false));
        });
    });
})();
;// Because sometimes you need to style the cursor's line.
//
// Adds an option 'styleActiveLine' which, when enabled, gives the
// active line's wrapping <div> the CSS class "CodeMirror-activeline",
// and gives its background <div> the class "CodeMirror-activeline-background".

(function (mod) {

    mod(CodeMirror);
})(function (CodeMirror) {
    "use strict";
    var WRAP_CLASS = "CodeMirror-activeline";
    var BACK_CLASS = "CodeMirror-activeline-background";

    CodeMirror.defineOption("styleActiveLine", false, function (cm, val, old) {
        var prev = old && old != CodeMirror.Init;
        if (val && !prev) {
            cm.state.activeLines = [];
            updateActiveLines(cm, cm.listSelections());
            cm.on("beforeSelectionChange", selectionChange);
        } else if (!val && prev) {
            cm.off("beforeSelectionChange", selectionChange);
            clearActiveLines(cm);
            delete cm.state.activeLines;
        }
    });

    function clearActiveLines(cm) {
        for (var i = 0; i < cm.state.activeLines.length; i++) {
            cm.removeLineClass(cm.state.activeLines[i], "wrap", WRAP_CLASS);
            cm.removeLineClass(cm.state.activeLines[i], "background", BACK_CLASS);
        }
    }

    function sameArray(a, b) {
        if (a.length != b.length)
            return false;
        for (var i = 0; i < a.length; i++)
            if (a[i] != b[i])
                return false;
        return true;
    }

    function updateActiveLines(cm, ranges) {
        var active = [];
        for (var i = 0; i < ranges.length; i++) {
            var line = cm.getLineHandleVisualStart(ranges[i].head.line);
            if (active[active.length - 1] != line)
                active.push(line);
        }
        if (sameArray(cm.state.activeLines, active))
            return;
        cm.operation(function () {
            clearActiveLines(cm);
            for (var i = 0; i < active.length; i++) {
                cm.addLineClass(active[i], "wrap", WRAP_CLASS);
                cm.addLineClass(active[i], "background", BACK_CLASS);
            }
            cm.state.activeLines = active;
        });
    }

    function selectionChange(cm, sel) {
        updateActiveLines(cm, sel.ranges);
    }
});
;(function (mod) {

    mod(CodeMirror);
})(function (CodeMirror) {
    var ie_lt8 = /MSIE \d/.test(navigator.userAgent) &&
            (document.documentMode == null || document.documentMode < 8);

    var Pos = CodeMirror.Pos;

    var matching = {"(": ")>", ")": "(<", "[": "]>", "]": "[<", "{": "}>", "}": "{<"};

    function findMatchingBracket(cm, where, strict, config) {
        var line = cm.getLineHandle(where.line), pos = where.ch - 1;
        var match = (pos >= 0 && matching[line.text.charAt(pos)]) || matching[line.text.charAt(++pos)];
        if (!match)
            return null;
        var dir = match.charAt(1) == ">" ? 1 : -1;
        if (strict && (dir > 0) != (pos == where.ch))
            return null;
        var style = cm.getTokenTypeAt(Pos(where.line, pos + 1));

        var found = scanForBracket(cm, Pos(where.line, pos + (dir > 0 ? 1 : 0)), dir, style || null, config);
        if (found == null)
            return null;
        return {from: Pos(where.line, pos), to: found && found.pos,
            match: found && found.ch == match.charAt(0), forward: dir > 0};
    }

    // bracketRegex is used to specify which type of bracket to scan
    // should be a regexp, e.g. /[[\]]/
    //
    // Note: If "where" is on an open bracket, then this bracket is ignored.
    //
    // Returns false when no bracket was found, null when it reached
    // maxScanLines and gave up
    function scanForBracket(cm, where, dir, style, config) {
        var maxScanLen = (config && config.maxScanLineLength) || 10000;
        var maxScanLines = (config && config.maxScanLines) || 1000;

        var stack = [];
        var re = config && config.bracketRegex ? config.bracketRegex : /[(){}[\]]/;
        var lineEnd = dir > 0 ? Math.min(where.line + maxScanLines, cm.lastLine() + 1)
                : Math.max(cm.firstLine() - 1, where.line - maxScanLines);
        for (var lineNo = where.line; lineNo != lineEnd; lineNo += dir) {
            var line = cm.getLine(lineNo);
            if (!line)
                continue;
            var pos = dir > 0 ? 0 : line.length - 1, end = dir > 0 ? line.length : -1;
            if (line.length > maxScanLen)
                continue;
            if (lineNo == where.line)
                pos = where.ch - (dir < 0 ? 1 : 0);
            for (; pos != end; pos += dir) {
                var ch = line.charAt(pos);
                if (re.test(ch) && (style === undefined || cm.getTokenTypeAt(Pos(lineNo, pos + 1)) == style)) {
                    var match = matching[ch];
                    if ((match.charAt(1) == ">") == (dir > 0))
                        stack.push(ch);
                    else if (!stack.length)
                        return {pos: Pos(lineNo, pos), ch: ch};
                    else
                        stack.pop();
                }
            }
        }
        return lineNo - dir == (dir > 0 ? cm.lastLine() : cm.firstLine()) ? false : null;
    }

    function matchBrackets(cm, autoclear, config) {
        // Disable brace matching in long lines, since it'll cause hugely slow updates
        var maxHighlightLen = cm.state.matchBrackets.maxHighlightLineLength || 1000;
        var marks = [], ranges = cm.listSelections();
        for (var i = 0; i < ranges.length; i++) {
            var match = ranges[i].empty() && findMatchingBracket(cm, ranges[i].head, false, config);
            if (match && cm.getLine(match.from.line).length <= maxHighlightLen) {
                var style = match.match ? "CodeMirror-matchingbracket" : "CodeMirror-nonmatchingbracket";
                marks.push(cm.markText(match.from, Pos(match.from.line, match.from.ch + 1), {className: style}));
                if (match.to && cm.getLine(match.to.line).length <= maxHighlightLen)
                    marks.push(cm.markText(match.to, Pos(match.to.line, match.to.ch + 1), {className: style}));
            }
        }

        if (marks.length) {
            // Kludge to work around the IE bug from issue #1193, where text
            // input stops going to the textare whever this fires.
            if (ie_lt8 && cm.state.focused)
                cm.display.input.focus();

            var clear = function () {
                cm.operation(function () {
                    for (var i = 0; i < marks.length; i++)
                        marks[i].clear();
                });
            };
            if (autoclear)
                setTimeout(clear, 800);
            else
                return clear;
        }
    }

    var currentlyHighlighted = null;
    function doMatchBrackets(cm) {
        cm.operation(function () {
            if (currentlyHighlighted) {
                currentlyHighlighted();
                currentlyHighlighted = null;
            }
            currentlyHighlighted = matchBrackets(cm, false, cm.state.matchBrackets);
        });
    }

    CodeMirror.defineOption("matchBrackets", false, function (cm, val, old) {
        if (old && old != CodeMirror.Init)
            cm.off("cursorActivity", doMatchBrackets);
        if (val) {
            cm.state.matchBrackets = typeof val == "object" ? val : {};
            cm.on("cursorActivity", doMatchBrackets);
        }
    });

    CodeMirror.defineExtension("matchBrackets", function () {
        matchBrackets(this, true);
    });
    CodeMirror.defineExtension("findMatchingBracket", function (pos, strict, config) {
        return findMatchingBracket(this, pos, strict, config);
    });
    CodeMirror.defineExtension("scanForBracket", function (pos, dir, style, config) {
        return scanForBracket(this, pos, dir, style, config);
    });
});
;(function (mod) {

    mod(CodeMirror);
})(function (CodeMirror) {
    "use strict";

    CodeMirror.defineMode("htmlmixed", function (config, parserConfig) {
        var htmlMode = CodeMirror.getMode(config, {name: "xml",
            htmlMode: true,
            multilineTagIndentFactor: parserConfig.multilineTagIndentFactor,
            multilineTagIndentPastTag: parserConfig.multilineTagIndentPastTag});
        var cssMode = CodeMirror.getMode(config, "css");

        var scriptTypes = [], scriptTypesConf = parserConfig && parserConfig.scriptTypes;
        scriptTypes.push({matches: /^(?:text|application)\/(?:x-)?(?:java|ecma)script$|^$/i,
            mode: CodeMirror.getMode(config, "javascript")});
        if (scriptTypesConf)
            for (var i = 0; i < scriptTypesConf.length; ++i) {
                var conf = scriptTypesConf[i];
                scriptTypes.push({matches: conf.matches, mode: conf.mode && CodeMirror.getMode(config, conf.mode)});
            }
        scriptTypes.push({matches: /./,
            mode: CodeMirror.getMode(config, "text/plain")});

        function html(stream, state) {
            var tagName = state.htmlState.tagName;
            var style = htmlMode.token(stream, state.htmlState);
            if (tagName == "script" && /\btag\b/.test(style) && stream.current() == ">") {
                // Script block: mode to change to depends on type attribute
                var scriptType = stream.string.slice(Math.max(0, stream.pos - 100), stream.pos).match(/\btype\s*=\s*("[^"]+"|'[^']+'|\S+)[^<]*$/i);
                scriptType = scriptType ? scriptType[1] : "";
                if (scriptType && /[\"\']/.test(scriptType.charAt(0)))
                    scriptType = scriptType.slice(1, scriptType.length - 1);
                for (var i = 0; i < scriptTypes.length; ++i) {
                    var tp = scriptTypes[i];
                    if (typeof tp.matches == "string" ? scriptType == tp.matches : tp.matches.test(scriptType)) {
                        if (tp.mode) {
                            state.token = script;
                            state.localMode = tp.mode;
                            state.localState = tp.mode.startState && tp.mode.startState(htmlMode.indent(state.htmlState, ""));
                        }
                        break;
                    }
                }
            } else if (tagName == "style" && /\btag\b/.test(style) && stream.current() == ">") {
                state.token = css;
                state.localMode = cssMode;
                state.localState = cssMode.startState(htmlMode.indent(state.htmlState, ""));
            }
            return style;
        }
        function maybeBackup(stream, pat, style) {
            var cur = stream.current();
            var close = cur.search(pat), m;
            if (close > -1)
                stream.backUp(cur.length - close);
            else if (m = cur.match(/<\/?$/)) {
                stream.backUp(cur.length);
                if (!stream.match(pat, false))
                    stream.match(cur);
            }
            return style;
        }
        function script(stream, state) {
            if (stream.match(/^<\/\s*script\s*>/i, false)) {
                state.token = html;
                state.localState = state.localMode = null;
                return html(stream, state);
            }
            return maybeBackup(stream, /<\/\s*script\s*>/,
                    state.localMode.token(stream, state.localState));
        }
        function css(stream, state) {
            if (stream.match(/^<\/\s*style\s*>/i, false)) {
                state.token = html;
                state.localState = state.localMode = null;
                return html(stream, state);
            }
            return maybeBackup(stream, /<\/\s*style\s*>/,
                    cssMode.token(stream, state.localState));
        }

        return {
            startState: function () {
                var state = htmlMode.startState();
                return {token: html, localMode: null, localState: null, htmlState: state};
            },
            copyState: function (state) {
                if (state.localState)
                    var local = CodeMirror.copyState(state.localMode, state.localState);
                return {token: state.token, localMode: state.localMode, localState: local,
                    htmlState: CodeMirror.copyState(htmlMode, state.htmlState)};
            },
            token: function (stream, state) {
                return state.token(stream, state);
            },
            indent: function (state, textAfter) {
                if (!state.localMode || /^\s*<\//.test(textAfter))
                    return htmlMode.indent(state.htmlState, textAfter);
                else if (state.localMode.indent)
                    return state.localMode.indent(state.localState, textAfter);
                else
                    return CodeMirror.Pass;
            },
            innerMode: function (state) {
                return {state: state.localState || state.htmlState, mode: state.localMode || htmlMode};
            }
        };
    }, "xml", "javascript", "css");

    CodeMirror.defineMIME("text/html", "htmlmixed");

});
;(function (mod) {

    mod(CodeMirror);
})(function (CodeMirror) {
    "use strict";

    CodeMirror.defineMode("xml", function (config, parserConfig) {
        var indentUnit = config.indentUnit;
        var multilineTagIndentFactor = parserConfig.multilineTagIndentFactor || 1;
        var multilineTagIndentPastTag = parserConfig.multilineTagIndentPastTag;
        if (multilineTagIndentPastTag == null)
            multilineTagIndentPastTag = true;

        var Kludges = parserConfig.htmlMode ? {
            autoSelfClosers: {'area': true, 'base': true, 'br': true, 'col': true, 'command': true,
                'embed': true, 'frame': true, 'hr': true, 'img': true, 'input': true,
                'keygen': true, 'meta': true, 'param': true, 'source': true,
                'track': true, 'wbr': true},
            implicitlyClosed: {'dd': true, 'li': true, 'optgroup': true, 'option': true, 'p': true,
                'rp': true, 'rt': true, 'tbody': true, 'td': true, 'tfoot': true,
                'th': true, 'tr': true, 'link': true},
            contextGrabbers: {
                'dd': {'dd': true, 'dt': true},
                'dt': {'dd': true, 'dt': true},
                'li': {'li': true},
                'option': {'option': true, 'optgroup': true},
                'optgroup': {'optgroup': true},
                'p': {'address': true, 'article': true, 'aside': true, 'blockquote': true, 'dir': true,
                    'div': true, 'dl': true, 'fieldset': true, 'footer': true, 'form': true,
                    'h1': true, 'h2': true, 'h3': true, 'h4': true, 'h5': true, 'h6': true,
                    'header': true, 'hgroup': true, 'hr': true, 'menu': true, 'nav': true, 'ol': true,
                    'p': true, 'pre': true, 'section': true, 'table': true, 'ul': true},
                'rp': {'rp': true, 'rt': true},
                'rt': {'rp': true, 'rt': true},
                'tbody': {'tbody': true, 'tfoot': true},
                'td': {'td': true, 'th': true},
                'tfoot': {'tbody': true},
                'th': {'td': true, 'th': true},
                'thead': {'tbody': true, 'tfoot': true},
                'tr': {'tr': true}
            },
            doNotIndent: {"pre": true},
            allowUnquoted: true,
            allowMissing: true,
            caseFold: true
        } : {
            autoSelfClosers: {},
            implicitlyClosed: {},
            contextGrabbers: {},
            doNotIndent: {},
            allowUnquoted: false,
            allowMissing: false,
            caseFold: false
        };
        var alignCDATA = parserConfig.alignCDATA;

        // Return variables for tokenizers
        var type, setStyle;

        function inText(stream, state) {
            function chain(parser) {
                state.tokenize = parser;
                return parser(stream, state);
            }

            var ch = stream.next();
            if (ch == "{" && stream.eat('{')) {
                type = "openTplAttribute";
                state.tokenize = inTplAttribute;
                state.attributeFirst = true;
                return "tpl attribute start";
            } else if (ch == "<") {
                if (stream.eat("!")) {
                    if (stream.eat("[")) {
                        if (stream.match("CDATA["))
                            return chain(inBlock("atom", "]]>"));
                        else
                            return null;
                    } else if (stream.match("--")) {
                        return chain(inBlock("comment", "-->"));
                    } else if (stream.match("DOCTYPE", true, true)) {
                        stream.eatWhile(/[\w\._\-]/);
                        return chain(doctype(1));
                    } else {
                        return null;
                    }
                } else if (stream.eat("?")) {
                    stream.eatWhile(/[\w\._\-]/);
                    state.tokenize = inBlock("meta", "?>");
                    return "meta";
                } else {
                    type = stream.eat("/") ? "closeTag" : "openTag";
                    state.tokenize = inTag;
                    return "tag bracket";
                }
            } else if (ch == "&") {
                var ok;
                if (stream.eat("#")) {
                    if (stream.eat("x")) {
                        ok = stream.eatWhile(/[a-fA-F\d]/) && stream.eat(";");
                    } else {
                        ok = stream.eatWhile(/[\d]/) && stream.eat(";");
                    }
                } else {
                    ok = stream.eatWhile(/[\w\.\-:]/) && stream.eat(";");
                }
                return ok ? "atom" : "error";
            } else {
                stream.eatWhile(/[^&<\{]/);
                return null;
            }
        }

        function eatWhile_xml(stream, match) {
            var attOption = "";
            var ch = stream.eat(match);
            while (ch) {
                attOption += ch;
                ch = stream.eat(match);
            }
            return attOption;
        }

        function inTplAttribute(stream, state) {
            var ch = stream.next();
            if (ch == "\n") {
                state.tokenize = inText;
                type = "endTplAttribute";
                return "tpl attribute end bad";
            } else if (ch == "}" && stream.eat("}")) {
                state.tokenize = inText;
                type = "endTplAttribute";
                return "tpl attribute end";
            } else if (ch == "=") {
                state.tokenize = inString;
                type = "string";
                return "tpl";
            } else {
                try {
                    var opt = eatWhile_xml(stream, /[^\.=\(\s\}\n]/);
                    var to_catch = ch + opt;
                    if (typeof OrdersExportTool != "undefined") {
                        if (to_catch == "product" || to_catch == "order" || to_catch == "billing" || to_catch == "shipping" || to_catch == "payment" || to_catch == "invoice" || to_catch == "shipment" || to_catch == "creditmemo") {
                            state.attributeFirst = true;
                            return "tpl attribute object";
                        }
                    } else if (typeof SimpleGoogleShopping != "undefined" || typeof DataFeedManager != "undefined") {
                        if (to_catch == "custom_options" || to_catch == "product" || to_catch == "parent" || to_catch == "bundle" || to_catch == "grouped" || to_catch == "configurable") {
                            state.attributeFirst = true;
                            return "tpl attribute object";
                        }
                    }
                } catch (e) {
                }
                var ret = "tpl attribute option";
                if (state.attributeFirst) {
                    ret = "tpl attribute property";
                }
                state.attributeFirst = false;
                state.tokenize = inTplAttribute;
                return ret;
            }
        }

        function inString(stream, state) {
            var ch = stream.next();
            if (ch == '"') {
                eatWhile_xml(stream, /[^"]/);
                stream.next();
                state.tokenize = inTplAttribute;
                type = "string";
                return "string";
            } else {
                eatWhile_xml(stream, /[^\s\}]/);
                state.tokenize = inTplAttribute;
                type = "string";
                return "string";
            }
        }


        function inTag(stream, state) {
            var ch = stream.next();
            if (ch == ">" || (ch == "/" && stream.eat(">"))) {
                state.tokenize = inText;
                type = ch == ">" ? "endTag" : "selfcloseTag";
                return "tag bracket";
            } else if (ch == "=") {
                type = "equals";
                return null;
            } else if (ch == "<") {
                state.tokenize = inText;
                state.state = baseState;
                state.tagName = state.tagStart = null;
                var next = state.tokenize(stream, state);
                return next ? next + " error" : "error";
            } else if (/[\'\"]/.test(ch)) {
                state.tokenize = inAttribute(ch);
                state.stringStartCol = stream.column();
                return state.tokenize(stream, state);
            } else {
                stream.match(/^[^\s\u00a0=<>\"\']*[^\s\u00a0=<>\"\'\/]/);
                return "word";
            }
        }

        function inAttribute(quote) {
            var closure = function (stream, state) {
                while (!stream.eol()) {
                    var ch = stream.next();
                    if (ch == quote) {
                        state.tokenize = inTag;
                        break;
                    }
                }
                return "string";
            };
            closure.isInAttribute = true;
            return closure;
        }

        function inBlock(style, terminator) {
            return function (stream, state) {
                while (!stream.eol()) {
                    if (stream.match(terminator)) {
                        state.tokenize = inText;
                        break;
                    }
                    stream.next();
                }
                return style;
            };
        }
        function doctype(depth) {
            return function (stream, state) {
                var ch;
                while ((ch = stream.next()) != null) {
                    if (ch == "<") {
                        state.tokenize = doctype(depth + 1);
                        return state.tokenize(stream, state);
                    } else if (ch == ">") {
                        if (depth == 1) {
                            state.tokenize = inText;
                            break;
                        } else {
                            state.tokenize = doctype(depth - 1);
                            return state.tokenize(stream, state);
                        }
                    }
                }
                return "meta";
            };
        }

        function Context(state, tagName, startOfLine) {
            this.prev = state.context;
            this.tagName = tagName;
            this.indent = state.indented;
            this.startOfLine = startOfLine;
            if (Kludges.doNotIndent.hasOwnProperty(tagName) || (state.context && state.context.noIndent))
                this.noIndent = true;
        }
        function popContext(state) {
            if (state.context)
                state.context = state.context.prev;
        }
        function maybePopContext(state, nextTagName) {
            var parentTagName;
            while (true) {
                if (!state.context) {
                    return;
                }
                parentTagName = state.context.tagName;
                if (!Kludges.contextGrabbers.hasOwnProperty(parentTagName) ||
                        !Kludges.contextGrabbers[parentTagName].hasOwnProperty(nextTagName)) {
                    return;
                }
                popContext(state);
            }
        }

        function baseState(type, stream, state) {
            if (type == "openTag") {
                state.tagStart = stream.column();
                return tagNameState;
            } else if (type == "closeTag") {
                return closeTagNameState;
            } else {
                return baseState;
            }
        }
        function tagNameState(type, stream, state) {
            if (type == "word") {
                state.tagName = stream.current();
                setStyle = "tag";
                return attrState;
            } else {
                setStyle = "error";
                return tagNameState;
            }
        }
        function closeTagNameState(type, stream, state) {
            if (type == "word") {
                var tagName = stream.current();
                if (state.context && state.context.tagName != tagName &&
                        Kludges.implicitlyClosed.hasOwnProperty(state.context.tagName))
                    popContext(state);
                if (state.context && state.context.tagName == tagName) {
                    setStyle = "tag";
                    return closeState;
                } else {
                    setStyle = "tag error";
                    return closeStateErr;
                }
            } else {
                setStyle = "error";
                return closeStateErr;
            }
        }

        function closeState(type, _stream, state) {
            if (type != "endTag") {
                setStyle = "error";
                return closeState;
            }
            popContext(state);
            return baseState;
        }
        function closeStateErr(type, stream, state) {
            setStyle = "error";
            return closeState(type, stream, state);
        }

        function attrState(type, _stream, state) {
            if (type == "word") {
                setStyle = "attribute";
                return attrEqState;
            } else if (type == "endTag" || type == "selfcloseTag") {
                var tagName = state.tagName, tagStart = state.tagStart;
                state.tagName = state.tagStart = null;
                if (type == "selfcloseTag" ||
                        Kludges.autoSelfClosers.hasOwnProperty(tagName)) {
                    maybePopContext(state, tagName);
                } else {
                    maybePopContext(state, tagName);
                    state.context = new Context(state, tagName, tagStart == state.indented);
                }
                return baseState;
            }
            setStyle = "error";
            return attrState;
        }
        function attrEqState(type, stream, state) {
            if (type == "equals")
                return attrValueState;
            if (!Kludges.allowMissing)
                setStyle = "error";
            return attrState(type, stream, state);
        }
        function attrValueState(type, stream, state) {
            if (type == "string")
                return attrContinuedState;
            if (type == "word" && Kludges.allowUnquoted) {
                setStyle = "string";
                return attrState;
            }
            setStyle = "";
            return attrState(type, stream, state);
        }
        function attrContinuedState(type, stream, state) {
            if (type == "string")
                return attrContinuedState;
            return attrState(type, stream, state);
        }

        return {
            startState: function () {
                return {tokenize: inText,
                    state: baseState,
                    indented: 0,
                    tagName: null, tagStart: null,
                    context: null};
            },
            token: function (stream, state) {
                if (!state.tagName && stream.sol())
                    state.indented = stream.indentation();

                if (stream.eatSpace())
                    return null;
                type = null;
                var style = state.tokenize(stream, state);
                if ((style || type) && style != "comment") {
                    setStyle = null;
                    state.state = state.state(type || style, stream, state);
                    if (setStyle)
                        style = setStyle == "error" ? style + " error" : setStyle;
                }
                return style;
            },
            indent: function (state, textAfter, fullLine) {
                var context = state.context;
                // Indent multi-line strings (e.g. css).
                if (state.tokenize.isInAttribute) {
                    if (state.tagStart == state.indented)
                        return state.stringStartCol + 1;
                    else
                        return state.indented + indentUnit;
                }
                if (context && context.noIndent)
                    return CodeMirror.Pass;
                if (state.tokenize != inTag && state.tokenize != inText)
                    return fullLine ? fullLine.match(/^(\s*)/)[0].length : 0;
                // Indent the starts of attribute names.
                if (state.tagName) {
                    if (multilineTagIndentPastTag)
                        return state.tagStart + state.tagName.length + 2;
                    else
                        return state.tagStart + indentUnit * multilineTagIndentFactor;
                }
                if (alignCDATA && /<!\[CDATA\[/.test(textAfter))
                    return 0;
                var tagAfter = textAfter && /^<(\/)?([\w_:\.-]*)/.exec(textAfter);
                if (tagAfter && tagAfter[1]) { // Closing tag spotted
                    while (context) {
                        if (context.tagName == tagAfter[2]) {
                            context = context.prev;
                            break;
                        } else if (Kludges.implicitlyClosed.hasOwnProperty(context.tagName)) {
                            context = context.prev;
                        } else {
                            break;
                        }
                    }
                } else if (tagAfter) { // Opening tag spotted
                    while (context) {
                        var grabbers = Kludges.contextGrabbers[context.tagName];
                        if (grabbers && grabbers.hasOwnProperty(tagAfter[2]))
                            context = context.prev;
                        else
                            break;
                    }
                }
                while (context && !context.startOfLine)
                    context = context.prev;
                if (context)
                    return context.indent + indentUnit;
                else
                    return 0;
            },
            electricInput: /<\/[\s\w:]+>$/,
            blockCommentStart: "<!--",
            blockCommentEnd: "-->",
            configuration: parserConfig.htmlMode ? "html" : "xml",
            helperType: parserConfig.htmlMode ? "html" : "xml"
        };
    });

    CodeMirror.defineMIME("text/xml", "xml");
    CodeMirror.defineMIME("application/xml", "xml");
    if (!CodeMirror.mimeModes.hasOwnProperty("text/html"))
        CodeMirror.defineMIME("text/html", {name: "xml", htmlMode: true});

});
;// TODO actually recognize syntax of TypeScript constructs

(function (mod) {

    mod(CodeMirror);
})(function (CodeMirror) {
    "use strict";

    CodeMirror.defineMode("javascript", function (config, parserConfig) {
        var indentUnit = config.indentUnit;
        var statementIndent = parserConfig.statementIndent;
        var jsonldMode = parserConfig.jsonld;
        var jsonMode = parserConfig.json || jsonldMode;
        var isTS = parserConfig.typescript;

        // Tokenizer

        var keywords = function () {
            function kw(type) {
                return {type: type, style: "keyword"};
            }
            var A = kw("keyword a"), B = kw("keyword b"), C = kw("keyword c");
            var operator = kw("operator"), atom = {type: "atom", style: "atom"};

            var jsKeywords = {
                "if": kw("if"), "while": A, "with": A, "else": B, "do": B, "try": B, "finally": B,
                "return": C, "break": C, "continue": C, "new": C, "delete": C, "throw": C, "debugger": C,
                "var": kw("var"), "const": kw("var"), "let": kw("var"),
                "function": kw("function"), "catch": kw("catch"),
                "for": kw("for"), "switch": kw("switch"), "case": kw("case"), "default": kw("default"),
                "in": operator, "typeof": operator, "instanceof": operator,
                "true": atom, "false": atom, "null": atom, "undefined": atom, "NaN": atom, "Infinity": atom,
                "this": kw("this"), "module": kw("module"), "class": kw("class"), "super": kw("atom"),
                "yield": C, "export": kw("export"), "import": kw("import"), "extends": C
            };

            // Extend the 'normal' keywords with the TypeScript language extensions
            if (isTS) {
                var type = {type: "variable", style: "variable-3"};
                var tsKeywords = {
                    // object-like things
                    "interface": kw("interface"),
                    "extends": kw("extends"),
                    "constructor": kw("constructor"),
                    // scope modifiers
                    "public": kw("public"),
                    "private": kw("private"),
                    "protected": kw("protected"),
                    "static": kw("static"),
                    // types
                    "string": type, "number": type, "bool": type, "any": type
                };

                for (var attr in tsKeywords) {
                    jsKeywords[attr] = tsKeywords[attr];
                }
            }

            return jsKeywords;
        }();

        var isOperatorChar = /[+\-*&%=<>!?|~^]/;
        var isJsonldKeyword = /^@(context|id|value|language|type|container|list|set|reverse|index|base|vocab|graph)"/;

        function readRegexp(stream) {
            var escaped = false, next, inSet = false;
            while ((next = stream.next()) != null) {
                if (!escaped) {
                    if (next == "/" && !inSet)
                        return;
                    if (next == "[")
                        inSet = true;
                    else if (inSet && next == "]")
                        inSet = false;
                }
                escaped = !escaped && next == "\\";
            }
        }

        // Used as scratch variables to communicate multiple values without
        // consing up tons of objects.
        var type, content;
        function ret(tp, style, cont) {
            type = tp;
            content = cont;
            return style;
        }
        function tokenBase(stream, state) {
            var ch = stream.next();
            if (ch == '"' || ch == "'") {
                state.tokenize = tokenString(ch);
                return state.tokenize(stream, state);
            } else if (ch == "." && stream.match(/^\d+(?:[eE][+\-]?\d+)?/)) {
                return ret("number", "number");
            } else if (ch == "." && stream.match("..")) {
                return ret("spread", "meta");
            } else if (/[\[\]{}\(\),;\:\.]/.test(ch)) {
                return ret(ch);
            } else if (ch == "=" && stream.eat(">")) {
                return ret("=>", "operator");
            } else if (ch == "0" && stream.eat(/x/i)) {
                stream.eatWhile(/[\da-f]/i);
                return ret("number", "number");
            } else if (/\d/.test(ch)) {
                stream.match(/^\d*(?:\.\d*)?(?:[eE][+\-]?\d+)?/);
                return ret("number", "number");
            } else if (ch == "/") {
                if (stream.eat("*")) {
                    state.tokenize = tokenComment;
                    return tokenComment(stream, state);
                } else if (stream.eat("/")) {
                    stream.skipToEnd();
                    return ret("comment", "comment");
                } else if (state.lastType == "operator" || state.lastType == "keyword c" ||
                        state.lastType == "sof" || /^[\[{}\(,;:]$/.test(state.lastType)) {
                    readRegexp(stream);
                    stream.eatWhile(/[gimy]/); // 'y' is "sticky" option in Mozilla
                    return ret("regexp", "string-2");
                } else {
                    stream.eatWhile(isOperatorChar);
                    return ret("operator", "operator", stream.current());
                }
            } else if (ch == "`") {
                state.tokenize = tokenQuasi;
                return tokenQuasi(stream, state);
            } else if (ch == "#") {
                stream.skipToEnd();
                return ret("error", "error");
            } else if (isOperatorChar.test(ch)) {
                stream.eatWhile(isOperatorChar);
                return ret("operator", "operator", stream.current());
            } else {
                stream.eatWhile(/[\w\$_]/);
                var word = stream.current(), known = keywords.propertyIsEnumerable(word) && keywords[word];
                return (known && state.lastType != ".") ? ret(known.type, known.style, word) :
                        ret("variable", "variable", word);
            }
        }

        function tokenString(quote) {
            return function (stream, state) {
                var escaped = false, next;
                if (jsonldMode && stream.peek() == "@" && stream.match(isJsonldKeyword)) {
                    state.tokenize = tokenBase;
                    return ret("jsonld-keyword", "meta");
                }
                while ((next = stream.next()) != null) {
                    if (next == quote && !escaped)
                        break;
                    escaped = !escaped && next == "\\";
                }
                if (!escaped)
                    state.tokenize = tokenBase;
                return ret("string", "string");
            };
        }

        function tokenComment(stream, state) {
            var maybeEnd = false, ch;
            while (ch = stream.next()) {
                if (ch == "/" && maybeEnd) {
                    state.tokenize = tokenBase;
                    break;
                }
                maybeEnd = (ch == "*");
            }
            return ret("comment", "comment");
        }

        function tokenQuasi(stream, state) {
            var escaped = false, next;
            while ((next = stream.next()) != null) {
                if (!escaped && (next == "`" || next == "$" && stream.eat("{"))) {
                    state.tokenize = tokenBase;
                    break;
                }
                escaped = !escaped && next == "\\";
            }
            return ret("quasi", "string-2", stream.current());
        }

        var brackets = "([{}])";
        // This is a crude lookahead trick to try and notice that we're
        // parsing the argument patterns for a fat-arrow function before we
        // actually hit the arrow token. It only works if the arrow is on
        // the same line as the arguments and there's no strange noise
        // (comments) in between. Fallback is to only notice when we hit the
        // arrow, and not declare the arguments as locals for the arrow
        // body.
        function findFatArrow(stream, state) {
            if (state.fatArrowAt)
                state.fatArrowAt = null;
            var arrow = stream.string.indexOf("=>", stream.start);
            if (arrow < 0)
                return;

            var depth = 0, sawSomething = false;
            for (var pos = arrow - 1; pos >= 0; --pos) {
                var ch = stream.string.charAt(pos);
                var bracket = brackets.indexOf(ch);
                if (bracket >= 0 && bracket < 3) {
                    if (!depth) {
                        ++pos;
                        break;
                    }
                    if (--depth == 0)
                        break;
                } else if (bracket >= 3 && bracket < 6) {
                    ++depth;
                } else if (/[$\w]/.test(ch)) {
                    sawSomething = true;
                } else if (sawSomething && !depth) {
                    ++pos;
                    break;
                }
            }
            if (sawSomething && !depth)
                state.fatArrowAt = pos;
        }

        // Parser

        var atomicTypes = {"atom": true, "number": true, "variable": true, "string": true, "regexp": true, "this": true, "jsonld-keyword": true};

        function JSLexical(indented, column, type, align, prev, info) {
            this.indented = indented;
            this.column = column;
            this.type = type;
            this.prev = prev;
            this.info = info;
            if (align != null)
                this.align = align;
        }

        function inScope(state, varname) {
            for (var v = state.localVars; v; v = v.next)
                if (v.name == varname)
                    return true;
            for (var cx = state.context; cx; cx = cx.prev) {
                for (var v = cx.vars; v; v = v.next)
                    if (v.name == varname)
                        return true;
            }
        }

        function parseJS(state, style, type, content, stream) {
            var cc = state.cc;
            // Communicate our context to the combinators.
            // (Less wasteful than consing up a hundred closures on every call.)
            cx.state = state;
            cx.stream = stream;
            cx.marked = null, cx.cc = cc;

            if (!state.lexical.hasOwnProperty("align"))
                state.lexical.align = true;

            while (true) {
                var combinator = cc.length ? cc.pop() : jsonMode ? expression : statement;
                if (combinator(type, content)) {
                    while (cc.length && cc[cc.length - 1].lex)
                        cc.pop()();
                    if (cx.marked)
                        return cx.marked;
                    if (type == "variable" && inScope(state, content))
                        return "variable-2";
                    return style;
                }
            }
        }

        // Combinator utils

        var cx = {state: null, column: null, marked: null, cc: null};
        function pass() {
            for (var i = arguments.length - 1; i >= 0; i--)
                cx.cc.push(arguments[i]);
        }
        function cont() {
            pass.apply(null, arguments);
            return true;
        }
        function register(varname) {
            function inList(list) {
                for (var v = list; v; v = v.next)
                    if (v.name == varname)
                        return true;
                return false;
            }
            var state = cx.state;
            if (state.context) {
                cx.marked = "def";
                if (inList(state.localVars))
                    return;
                state.localVars = {name: varname, next: state.localVars};
            } else {
                if (inList(state.globalVars))
                    return;
                if (parserConfig.globalVars)
                    state.globalVars = {name: varname, next: state.globalVars};
            }
        }

        // Combinators

        var defaultVars = {name: "this", next: {name: "arguments"}};
        function pushcontext() {
            cx.state.context = {prev: cx.state.context, vars: cx.state.localVars};
            cx.state.localVars = defaultVars;
        }
        function popcontext() {
            cx.state.localVars = cx.state.context.vars;
            cx.state.context = cx.state.context.prev;
        }
        function pushlex(type, info) {
            var result = function () {
                var state = cx.state, indent = state.indented;
                if (state.lexical.type == "stat")
                    indent = state.lexical.indented;
                state.lexical = new JSLexical(indent, cx.stream.column(), type, null, state.lexical, info);
            };
            result.lex = true;
            return result;
        }
        function poplex() {
            var state = cx.state;
            if (state.lexical.prev) {
                if (state.lexical.type == ")")
                    state.indented = state.lexical.indented;
                state.lexical = state.lexical.prev;
            }
        }
        poplex.lex = true;

        function expect(wanted) {
            function exp(type) {
                if (type == wanted)
                    return cont();
                else if (wanted == ";")
                    return pass();
                else
                    return cont(exp);
            }
            ;
            return exp;
        }

        function statement(type, value) {
            if (type == "var")
                return cont(pushlex("vardef", value.length), vardef, expect(";"), poplex);
            if (type == "keyword a")
                return cont(pushlex("form"), expression, statement, poplex);
            if (type == "keyword b")
                return cont(pushlex("form"), statement, poplex);
            if (type == "{")
                return cont(pushlex("}"), block, poplex);
            if (type == ";")
                return cont();
            if (type == "if") {
                if (cx.state.lexical.info == "else" && cx.state.cc[cx.state.cc.length - 1] == poplex)
                    cx.state.cc.pop()();
                return cont(pushlex("form"), expression, statement, poplex, maybeelse);
            }
            if (type == "function")
                return cont(functiondef);
            if (type == "for")
                return cont(pushlex("form"), forspec, statement, poplex);
            if (type == "variable")
                return cont(pushlex("stat"), maybelabel);
            if (type == "switch")
                return cont(pushlex("form"), expression, pushlex("}", "switch"), expect("{"),
                        block, poplex, poplex);
            if (type == "case")
                return cont(expression, expect(":"));
            if (type == "default")
                return cont(expect(":"));
            if (type == "catch")
                return cont(pushlex("form"), pushcontext, expect("("), funarg, expect(")"),
                        statement, poplex, popcontext);
            if (type == "module")
                return cont(pushlex("form"), pushcontext, afterModule, popcontext, poplex);
            if (type == "class")
                return cont(pushlex("form"), className, objlit, poplex);
            if (type == "export")
                return cont(pushlex("form"), afterExport, poplex);
            if (type == "import")
                return cont(pushlex("form"), afterImport, poplex);
            return pass(pushlex("stat"), expression, expect(";"), poplex);
        }
        function expression(type) {
            return expressionInner(type, false);
        }
        function expressionNoComma(type) {
            return expressionInner(type, true);
        }
        function expressionInner(type, noComma) {
            if (cx.state.fatArrowAt == cx.stream.start) {
                var body = noComma ? arrowBodyNoComma : arrowBody;
                if (type == "(")
                    return cont(pushcontext, pushlex(")"), commasep(pattern, ")"), poplex, expect("=>"), body, popcontext);
                else if (type == "variable")
                    return pass(pushcontext, pattern, expect("=>"), body, popcontext);
            }

            var maybeop = noComma ? maybeoperatorNoComma : maybeoperatorComma;
            if (atomicTypes.hasOwnProperty(type))
                return cont(maybeop);
            if (type == "function")
                return cont(functiondef, maybeop);
            if (type == "keyword c")
                return cont(noComma ? maybeexpressionNoComma : maybeexpression);
            if (type == "(")
                return cont(pushlex(")"), maybeexpression, comprehension, expect(")"), poplex, maybeop);
            if (type == "operator" || type == "spread")
                return cont(noComma ? expressionNoComma : expression);
            if (type == "[")
                return cont(pushlex("]"), arrayLiteral, poplex, maybeop);
            if (type == "{")
                return contCommasep(objprop, "}", null, maybeop);
            if (type == "quasi") {
                return pass(quasi, maybeop);
            }
            return cont();
        }
        function maybeexpression(type) {
            if (type.match(/[;\}\)\],]/))
                return pass();
            return pass(expression);
        }
        function maybeexpressionNoComma(type) {
            if (type.match(/[;\}\)\],]/))
                return pass();
            return pass(expressionNoComma);
        }

        function maybeoperatorComma(type, value) {
            if (type == ",")
                return cont(expression);
            return maybeoperatorNoComma(type, value, false);
        }
        function maybeoperatorNoComma(type, value, noComma) {
            var me = noComma == false ? maybeoperatorComma : maybeoperatorNoComma;
            var expr = noComma == false ? expression : expressionNoComma;
            if (value == "=>")
                return cont(pushcontext, noComma ? arrowBodyNoComma : arrowBody, popcontext);
            if (type == "operator") {
                if (/\+\+|--/.test(value))
                    return cont(me);
                if (value == "?")
                    return cont(expression, expect(":"), expr);
                return cont(expr);
            }
            if (type == "quasi") {
                return pass(quasi, me);
            }
            if (type == ";")
                return;
            if (type == "(")
                return contCommasep(expressionNoComma, ")", "call", me);
            if (type == ".")
                return cont(property, me);
            if (type == "[")
                return cont(pushlex("]"), maybeexpression, expect("]"), poplex, me);
        }
        function quasi(type, value) {
            if (type != "quasi")
                return pass();
            if (value.slice(value.length - 2) != "${")
                return cont(quasi);
            return cont(expression, continueQuasi);
        }
        function continueQuasi(type) {
            if (type == "}") {
                cx.marked = "string-2";
                cx.state.tokenize = tokenQuasi;
                return cont(quasi);
            }
        }
        function arrowBody(type) {
            findFatArrow(cx.stream, cx.state);
            if (type == "{")
                return pass(statement);
            return pass(expression);
        }
        function arrowBodyNoComma(type) {
            findFatArrow(cx.stream, cx.state);
            if (type == "{")
                return pass(statement);
            return pass(expressionNoComma);
        }
        function maybelabel(type) {
            if (type == ":")
                return cont(poplex, statement);
            return pass(maybeoperatorComma, expect(";"), poplex);
        }
        function property(type) {
            if (type == "variable") {
                cx.marked = "property";
                return cont();
            }
        }
        function objprop(type, value) {
            if (type == "variable") {
                cx.marked = "property";
                if (value == "get" || value == "set")
                    return cont(getterSetter);
            } else if (type == "number" || type == "string") {
                cx.marked = jsonldMode ? "property" : (type + " property");
            } else if (type == "[") {
                return cont(expression, expect("]"), afterprop);
            }
            if (atomicTypes.hasOwnProperty(type))
                return cont(afterprop);
        }
        function getterSetter(type) {
            if (type != "variable")
                return pass(afterprop);
            cx.marked = "property";
            return cont(functiondef);
        }
        function afterprop(type) {
            if (type == ":")
                return cont(expressionNoComma);
            if (type == "(")
                return pass(functiondef);
        }
        function commasep(what, end) {
            function proceed(type) {
                if (type == ",") {
                    var lex = cx.state.lexical;
                    if (lex.info == "call")
                        lex.pos = (lex.pos || 0) + 1;
                    return cont(what, proceed);
                }
                if (type == end)
                    return cont();
                return cont(expect(end));
            }
            return function (type) {
                if (type == end)
                    return cont();
                return pass(what, proceed);
            };
        }
        function contCommasep(what, end, info) {
            for (var i = 3; i < arguments.length; i++)
                cx.cc.push(arguments[i]);
            return cont(pushlex(end, info), commasep(what, end), poplex);
        }
        function block(type) {
            if (type == "}")
                return cont();
            return pass(statement, block);
        }
        function maybetype(type) {
            if (isTS && type == ":")
                return cont(typedef);
        }
        function typedef(type) {
            if (type == "variable") {
                cx.marked = "variable-3";
                return cont();
            }
        }
        function vardef() {
            return pass(pattern, maybetype, maybeAssign, vardefCont);
        }
        function pattern(type, value) {
            if (type == "variable") {
                register(value);
                return cont();
            }
            if (type == "[")
                return contCommasep(pattern, "]");
            if (type == "{")
                return contCommasep(proppattern, "}");
        }
        function proppattern(type, value) {
            if (type == "variable" && !cx.stream.match(/^\s*:/, false)) {
                register(value);
                return cont(maybeAssign);
            }
            if (type == "variable")
                cx.marked = "property";
            return cont(expect(":"), pattern, maybeAssign);
        }
        function maybeAssign(_type, value) {
            if (value == "=")
                return cont(expressionNoComma);
        }
        function vardefCont(type) {
            if (type == ",")
                return cont(vardef);
        }
        function maybeelse(type, value) {
            if (type == "keyword b" && value == "else")
                return cont(pushlex("form", "else"), statement, poplex);
        }
        function forspec(type) {
            if (type == "(")
                return cont(pushlex(")"), forspec1, expect(")"), poplex);
        }
        function forspec1(type) {
            if (type == "var")
                return cont(vardef, expect(";"), forspec2);
            if (type == ";")
                return cont(forspec2);
            if (type == "variable")
                return cont(formaybeinof);
            return pass(expression, expect(";"), forspec2);
        }
        function formaybeinof(_type, value) {
            if (value == "in" || value == "of") {
                cx.marked = "keyword";
                return cont(expression);
            }
            return cont(maybeoperatorComma, forspec2);
        }
        function forspec2(type, value) {
            if (type == ";")
                return cont(forspec3);
            if (value == "in" || value == "of") {
                cx.marked = "keyword";
                return cont(expression);
            }
            return pass(expression, expect(";"), forspec3);
        }
        function forspec3(type) {
            if (type != ")")
                cont(expression);
        }
        function functiondef(type, value) {
            if (value == "*") {
                cx.marked = "keyword";
                return cont(functiondef);
            }
            if (type == "variable") {
                register(value);
                return cont(functiondef);
            }
            if (type == "(")
                return cont(pushcontext, pushlex(")"), commasep(funarg, ")"), poplex, statement, popcontext);
        }
        function funarg(type) {
            if (type == "spread")
                return cont(funarg);
            return pass(pattern, maybetype);
        }
        function className(type, value) {
            if (type == "variable") {
                register(value);
                return cont(classNameAfter);
            }
        }
        function classNameAfter(_type, value) {
            if (value == "extends")
                return cont(expression);
        }
        function objlit(type) {
            if (type == "{")
                return contCommasep(objprop, "}");
        }
        function afterModule(type, value) {
            if (type == "string")
                return cont(statement);
            if (type == "variable") {
                register(value);
                return cont(maybeFrom);
            }
        }
        function afterExport(_type, value) {
            if (value == "*") {
                cx.marked = "keyword";
                return cont(maybeFrom, expect(";"));
            }
            if (value == "default") {
                cx.marked = "keyword";
                return cont(expression, expect(";"));
            }
            return pass(statement);
        }
        function afterImport(type) {
            if (type == "string")
                return cont();
            return pass(importSpec, maybeFrom);
        }
        function importSpec(type, value) {
            if (type == "{")
                return contCommasep(importSpec, "}");
            if (type == "variable")
                register(value);
            return cont();
        }
        function maybeFrom(_type, value) {
            if (value == "from") {
                cx.marked = "keyword";
                return cont(expression);
            }
        }
        function arrayLiteral(type) {
            if (type == "]")
                return cont();
            return pass(expressionNoComma, maybeArrayComprehension);
        }
        function maybeArrayComprehension(type) {
            if (type == "for")
                return pass(comprehension, expect("]"));
            if (type == ",")
                return cont(commasep(expressionNoComma, "]"));
            return pass(commasep(expressionNoComma, "]"));
        }
        function comprehension(type) {
            if (type == "for")
                return cont(forspec, comprehension);
            if (type == "if")
                return cont(expression, comprehension);
        }

        // Interface

        return {
            startState: function (basecolumn) {
                var state = {
                    tokenize: tokenBase,
                    lastType: "sof",
                    cc: [],
                    lexical: new JSLexical((basecolumn || 0) - indentUnit, 0, "block", false),
                    localVars: parserConfig.localVars,
                    context: parserConfig.localVars && {vars: parserConfig.localVars},
                    indented: 0
                };
                if (parserConfig.globalVars && typeof parserConfig.globalVars == "object")
                    state.globalVars = parserConfig.globalVars;
                return state;
            },
            token: function (stream, state) {
                if (stream.sol()) {
                    if (!state.lexical.hasOwnProperty("align"))
                        state.lexical.align = false;
                    state.indented = stream.indentation();
                    findFatArrow(stream, state);
                }
                if (state.tokenize != tokenComment && stream.eatSpace())
                    return null;
                var style = state.tokenize(stream, state);
                if (type == "comment")
                    return style;
                state.lastType = type == "operator" && (content == "++" || content == "--") ? "incdec" : type;
                return parseJS(state, style, type, content, stream);
            },
            indent: function (state, textAfter) {
                if (state.tokenize == tokenComment)
                    return CodeMirror.Pass;
                if (state.tokenize != tokenBase)
                    return 0;
                var firstChar = textAfter && textAfter.charAt(0), lexical = state.lexical;
                // Kludge to prevent 'maybelse' from blocking lexical scope pops
                if (!/^\s*else\b/.test(textAfter))
                    for (var i = state.cc.length - 1; i >= 0; --i) {
                        var c = state.cc[i];
                        if (c == poplex)
                            lexical = lexical.prev;
                        else if (c != maybeelse)
                            break;
                    }
                if (lexical.type == "stat" && firstChar == "}")
                    lexical = lexical.prev;
                if (statementIndent && lexical.type == ")" && lexical.prev.type == "stat")
                    lexical = lexical.prev;
                var type = lexical.type, closing = firstChar == type;

                if (type == "vardef")
                    return lexical.indented + (state.lastType == "operator" || state.lastType == "," ? lexical.info + 1 : 0);
                else if (type == "form" && firstChar == "{")
                    return lexical.indented;
                else if (type == "form")
                    return lexical.indented + indentUnit;
                else if (type == "stat")
                    return lexical.indented + (state.lastType == "operator" || state.lastType == "," ? statementIndent || indentUnit : 0);
                else if (lexical.info == "switch" && !closing && parserConfig.doubleIndentSwitch != false)
                    return lexical.indented + (/^(?:case|default)\b/.test(textAfter) ? indentUnit : 2 * indentUnit);
                else if (lexical.align)
                    return lexical.column + (closing ? 0 : 1);
                else
                    return lexical.indented + (closing ? 0 : indentUnit);
            },
            electricChars: ":{}",
            blockCommentStart: jsonMode ? null : "/*",
            blockCommentEnd: jsonMode ? null : "*/",
            lineComment: jsonMode ? null : "//",
            fold: "brace",
            helperType: jsonMode ? "json" : "javascript",
            jsonldMode: jsonldMode,
            jsonMode: jsonMode
        };
    });

    CodeMirror.defineMIME("text/javascript", "javascript");
    CodeMirror.defineMIME("text/ecmascript", "javascript");
    CodeMirror.defineMIME("application/javascript", "javascript");
    CodeMirror.defineMIME("application/ecmascript", "javascript");
    CodeMirror.defineMIME("application/json", {name: "javascript", json: true});
    CodeMirror.defineMIME("application/x-json", {name: "javascript", json: true});
    CodeMirror.defineMIME("application/ld+json", {name: "javascript", jsonld: true});
    CodeMirror.defineMIME("text/typescript", {name: "javascript", typescript: true});
    CodeMirror.defineMIME("application/typescript", {name: "javascript", typescript: true});

});
;(function (mod) {

    mod(CodeMirror);
})(function (CodeMirror) {
    "use strict";

    CodeMirror.defineMode("css", function (config, parserConfig) {
        if (!parserConfig.propertyKeywords)
            parserConfig = CodeMirror.resolveMode("text/css");

        var indentUnit = config.indentUnit,
                tokenHooks = parserConfig.tokenHooks,
                mediaTypes = parserConfig.mediaTypes || {},
                mediaFeatures = parserConfig.mediaFeatures || {},
                propertyKeywords = parserConfig.propertyKeywords || {},
                nonStandardPropertyKeywords = parserConfig.nonStandardPropertyKeywords || {},
                colorKeywords = parserConfig.colorKeywords || {},
                valueKeywords = parserConfig.valueKeywords || {},
                fontProperties = parserConfig.fontProperties || {},
                allowNested = parserConfig.allowNested;

        var type, override;
        function ret(style, tp) {
            type = tp;
            return style;
        }

        // Tokenizers

        function tokenBase(stream, state) {
            var ch = stream.next();
            if (tokenHooks[ch]) {
                var result = tokenHooks[ch](stream, state);
                if (result !== false)
                    return result;
            }
            if (ch == "@") {
                stream.eatWhile(/[\w\\\-]/);
                return ret("def", stream.current());
            } else if (ch == "=" || (ch == "~" || ch == "|") && stream.eat("=")) {
                return ret(null, "compare");
            } else if (ch == "\"" || ch == "'") {
                state.tokenize = tokenString(ch);
                return state.tokenize(stream, state);
            } else if (ch == "#") {
                stream.eatWhile(/[\w\\\-]/);
                return ret("atom", "hash");
            } else if (ch == "!") {
                stream.match(/^\s*\w*/);
                return ret("keyword", "important");
            } else if (/\d/.test(ch) || ch == "." && stream.eat(/\d/)) {
                stream.eatWhile(/[\w.%]/);
                return ret("number", "unit");
            } else if (ch === "-") {
                if (/[\d.]/.test(stream.peek())) {
                    stream.eatWhile(/[\w.%]/);
                    return ret("number", "unit");
                } else if (stream.match(/^[^-]+-/)) {
                    return ret("meta", "meta");
                }
            } else if (/[,+>*\/]/.test(ch)) {
                return ret(null, "select-op");
            } else if (ch == "." && stream.match(/^-?[_a-z][_a-z0-9-]*/i)) {
                return ret("qualifier", "qualifier");
            } else if (/[:;{}\[\]\(\)]/.test(ch)) {
                return ret(null, ch);
            } else if (ch == "u" && stream.match("rl(")) {
                stream.backUp(1);
                state.tokenize = tokenParenthesized;
                return ret("property", "word");
            } else if (/[\w\\\-]/.test(ch)) {
                stream.eatWhile(/[\w\\\-]/);
                return ret("property", "word");
            } else {
                return ret(null, null);
            }
        }

        function tokenString(quote) {
            return function (stream, state) {
                var escaped = false, ch;
                while ((ch = stream.next()) != null) {
                    if (ch == quote && !escaped) {
                        if (quote == ")")
                            stream.backUp(1);
                        break;
                    }
                    escaped = !escaped && ch == "\\";
                }
                if (ch == quote || !escaped && quote != ")")
                    state.tokenize = null;
                return ret("string", "string");
            };
        }

        function tokenParenthesized(stream, state) {
            stream.next(); // Must be '('
            if (!stream.match(/\s*[\"\')]/, false))
                state.tokenize = tokenString(")");
            else
                state.tokenize = null;
            return ret(null, "(");
        }

        // Context management

        function Context(type, indent, prev) {
            this.type = type;
            this.indent = indent;
            this.prev = prev;
        }

        function pushContext(state, stream, type) {
            state.context = new Context(type, stream.indentation() + indentUnit, state.context);
            return type;
        }

        function popContext(state) {
            state.context = state.context.prev;
            return state.context.type;
        }

        function pass(type, stream, state) {
            return states[state.context.type](type, stream, state);
        }
        function popAndPass(type, stream, state, n) {
            for (var i = n || 1; i > 0; i--)
                state.context = state.context.prev;
            return pass(type, stream, state);
        }

        // Parser

        function wordAsValue(stream) {
            var word = stream.current().toLowerCase();
            if (valueKeywords.hasOwnProperty(word))
                override = "atom";
            else if (colorKeywords.hasOwnProperty(word))
                override = "keyword";
            else
                override = "variable";
        }

        var states = {};

        states.top = function (type, stream, state) {
            if (type == "{") {
                return pushContext(state, stream, "block");
            } else if (type == "}" && state.context.prev) {
                return popContext(state);
            } else if (type == "@media") {
                return pushContext(state, stream, "media");
            } else if (type == "@font-face") {
                return "font_face_before";
            } else if (/^@(-(moz|ms|o|webkit)-)?keyframes$/.test(type)) {
                return "keyframes";
            } else if (type && type.charAt(0) == "@") {
                return pushContext(state, stream, "at");
            } else if (type == "hash") {
                override = "builtin";
            } else if (type == "word") {
                override = "tag";
            } else if (type == "variable-definition") {
                return "maybeprop";
            } else if (type == "interpolation") {
                return pushContext(state, stream, "interpolation");
            } else if (type == ":") {
                return "pseudo";
            } else if (allowNested && type == "(") {
                return pushContext(state, stream, "params");
            }
            return state.context.type;
        };

        states.block = function (type, stream, state) {
            if (type == "word") {
                var word = stream.current().toLowerCase();
                if (propertyKeywords.hasOwnProperty(word)) {
                    override = "property";
                    return "maybeprop";
                } else if (nonStandardPropertyKeywords.hasOwnProperty(word)) {
                    override = "string-2";
                    return "maybeprop";
                } else if (allowNested) {
                    override = stream.match(/^\s*:/, false) ? "property" : "tag";
                    return "block";
                } else {
                    override += " error";
                    return "maybeprop";
                }
            } else if (type == "meta") {
                return "block";
            } else if (!allowNested && (type == "hash" || type == "qualifier")) {
                override = "error";
                return "block";
            } else {
                return states.top(type, stream, state);
            }
        };

        states.maybeprop = function (type, stream, state) {
            if (type == ":")
                return pushContext(state, stream, "prop");
            return pass(type, stream, state);
        };

        states.prop = function (type, stream, state) {
            if (type == ";")
                return popContext(state);
            if (type == "{" && allowNested)
                return pushContext(state, stream, "propBlock");
            if (type == "}" || type == "{")
                return popAndPass(type, stream, state);
            if (type == "(")
                return pushContext(state, stream, "parens");

            if (type == "hash" && !/^#([0-9a-fA-f]{3}|[0-9a-fA-f]{6})$/.test(stream.current())) {
                override += " error";
            } else if (type == "word") {
                wordAsValue(stream);
            } else if (type == "interpolation") {
                return pushContext(state, stream, "interpolation");
            }
            return "prop";
        };

        states.propBlock = function (type, _stream, state) {
            if (type == "}")
                return popContext(state);
            if (type == "word") {
                override = "property";
                return "maybeprop";
            }
            return state.context.type;
        };

        states.parens = function (type, stream, state) {
            if (type == "{" || type == "}")
                return popAndPass(type, stream, state);
            if (type == ")")
                return popContext(state);
            return "parens";
        };

        states.pseudo = function (type, stream, state) {
            if (type == "word") {
                override = "variable-3";
                return state.context.type;
            }
            return pass(type, stream, state);
        };

        states.media = function (type, stream, state) {
            if (type == "(")
                return pushContext(state, stream, "media_parens");
            if (type == "}")
                return popAndPass(type, stream, state);
            if (type == "{")
                return popContext(state) && pushContext(state, stream, allowNested ? "block" : "top");

            if (type == "word") {
                var word = stream.current().toLowerCase();
                if (word == "only" || word == "not" || word == "and")
                    override = "keyword";
                else if (mediaTypes.hasOwnProperty(word))
                    override = "attribute";
                else if (mediaFeatures.hasOwnProperty(word))
                    override = "property";
                else
                    override = "error";
            }
            return state.context.type;
        };

        states.media_parens = function (type, stream, state) {
            if (type == ")")
                return popContext(state);
            if (type == "{" || type == "}")
                return popAndPass(type, stream, state, 2);
            return states.media(type, stream, state);
        };

        states.font_face_before = function (type, stream, state) {
            if (type == "{")
                return pushContext(state, stream, "font_face");
            return pass(type, stream, state);
        };

        states.font_face = function (type, stream, state) {
            if (type == "}")
                return popContext(state);
            if (type == "word") {
                if (!fontProperties.hasOwnProperty(stream.current().toLowerCase()))
                    override = "error";
                else
                    override = "property";
                return "maybeprop";
            }
            return "font_face";
        };

        states.keyframes = function (type, stream, state) {
            if (type == "word") {
                override = "variable";
                return "keyframes";
            }
            if (type == "{")
                return pushContext(state, stream, "top");
            return pass(type, stream, state);
        };

        states.at = function (type, stream, state) {
            if (type == ";")
                return popContext(state);
            if (type == "{" || type == "}")
                return popAndPass(type, stream, state);
            if (type == "word")
                override = "tag";
            else if (type == "hash")
                override = "builtin";
            return "at";
        };

        states.interpolation = function (type, stream, state) {
            if (type == "}")
                return popContext(state);
            if (type == "{" || type == ";")
                return popAndPass(type, stream, state);
            if (type != "variable")
                override = "error";
            return "interpolation";
        };

        states.params = function (type, stream, state) {
            if (type == ")")
                return popContext(state);
            if (type == "{" || type == "}")
                return popAndPass(type, stream, state);
            if (type == "word")
                wordAsValue(stream);
            return "params";
        };

        return {
            startState: function (base) {
                return {tokenize: null,
                    state: "top",
                    context: new Context("top", base || 0, null)};
            },
            token: function (stream, state) {
                if (!state.tokenize && stream.eatSpace())
                    return null;
                var style = (state.tokenize || tokenBase)(stream, state);
                if (style && typeof style == "object") {
                    type = style[1];
                    style = style[0];
                }
                override = style;
                state.state = states[state.state](type, stream, state);
                return override;
            },
            indent: function (state, textAfter) {
                var cx = state.context, ch = textAfter && textAfter.charAt(0);
                var indent = cx.indent;
                if (cx.type == "prop" && ch == "}")
                    cx = cx.prev;
                if (cx.prev &&
                        (ch == "}" && (cx.type == "block" || cx.type == "top" || cx.type == "interpolation" || cx.type == "font_face") ||
                                ch == ")" && (cx.type == "parens" || cx.type == "params" || cx.type == "media_parens") ||
                                ch == "{" && (cx.type == "at" || cx.type == "media"))) {
                    indent = cx.indent - indentUnit;
                    cx = cx.prev;
                }
                return indent;
            },
            electricChars: "}",
            blockCommentStart: "/*",
            blockCommentEnd: "*/",
            fold: "brace"
        };
    });

    function keySet(array) {
        var keys = {};
        for (var i = 0; i < array.length; ++i) {
            keys[array[i]] = true;
        }
        return keys;
    }

    var mediaTypes_ = [
        "all", "aural", "braille", "handheld", "print", "projection", "screen",
        "tty", "tv", "embossed"
    ], mediaTypes = keySet(mediaTypes_);

    var mediaFeatures_ = [
        "width", "min-width", "max-width", "height", "min-height", "max-height",
        "device-width", "min-device-width", "max-device-width", "device-height",
        "min-device-height", "max-device-height", "aspect-ratio",
        "min-aspect-ratio", "max-aspect-ratio", "device-aspect-ratio",
        "min-device-aspect-ratio", "max-device-aspect-ratio", "color", "min-color",
        "max-color", "color-index", "min-color-index", "max-color-index",
        "monochrome", "min-monochrome", "max-monochrome", "resolution",
        "min-resolution", "max-resolution", "scan", "grid"
    ], mediaFeatures = keySet(mediaFeatures_);

    var propertyKeywords_ = [
        "align-content", "align-items", "align-self", "alignment-adjust",
        "alignment-baseline", "anchor-point", "animation", "animation-delay",
        "animation-direction", "animation-duration", "animation-fill-mode",
        "animation-iteration-count", "animation-name", "animation-play-state",
        "animation-timing-function", "appearance", "azimuth", "backface-visibility",
        "background", "background-attachment", "background-clip", "background-color",
        "background-image", "background-origin", "background-position",
        "background-repeat", "background-size", "baseline-shift", "binding",
        "bleed", "bookmark-label", "bookmark-level", "bookmark-state",
        "bookmark-target", "border", "border-bottom", "border-bottom-color",
        "border-bottom-left-radius", "border-bottom-right-radius",
        "border-bottom-style", "border-bottom-width", "border-collapse",
        "border-color", "border-image", "border-image-outset",
        "border-image-repeat", "border-image-slice", "border-image-source",
        "border-image-width", "border-left", "border-left-color",
        "border-left-style", "border-left-width", "border-radius", "border-right",
        "border-right-color", "border-right-style", "border-right-width",
        "border-spacing", "border-style", "border-top", "border-top-color",
        "border-top-left-radius", "border-top-right-radius", "border-top-style",
        "border-top-width", "border-width", "bottom", "box-decoration-break",
        "box-shadow", "box-sizing", "break-after", "break-before", "break-inside",
        "caption-side", "clear", "clip", "color", "color-profile", "column-count",
        "column-fill", "column-gap", "column-rule", "column-rule-color",
        "column-rule-style", "column-rule-width", "column-span", "column-width",
        "columns", "content", "counter-increment", "counter-reset", "crop", "cue",
        "cue-after", "cue-before", "cursor", "direction", "display",
        "dominant-baseline", "drop-initial-after-adjust",
        "drop-initial-after-align", "drop-initial-before-adjust",
        "drop-initial-before-align", "drop-initial-size", "drop-initial-value",
        "elevation", "empty-cells", "fit", "fit-position", "flex", "flex-basis",
        "flex-direction", "flex-flow", "flex-grow", "flex-shrink", "flex-wrap",
        "float", "float-offset", "flow-from", "flow-into", "font", "font-feature-settings",
        "font-family", "font-kerning", "font-language-override", "font-size", "font-size-adjust",
        "font-stretch", "font-style", "font-synthesis", "font-variant",
        "font-variant-alternates", "font-variant-caps", "font-variant-east-asian",
        "font-variant-ligatures", "font-variant-numeric", "font-variant-position",
        "font-weight", "grid", "grid-area", "grid-auto-columns", "grid-auto-flow",
        "grid-auto-position", "grid-auto-rows", "grid-column", "grid-column-end",
        "grid-column-start", "grid-row", "grid-row-end", "grid-row-start",
        "grid-template", "grid-template-areas", "grid-template-columns",
        "grid-template-rows", "hanging-punctuation", "height", "hyphens",
        "icon", "image-orientation", "image-rendering", "image-resolution",
        "inline-box-align", "justify-content", "left", "letter-spacing",
        "line-break", "line-height", "line-stacking", "line-stacking-ruby",
        "line-stacking-shift", "line-stacking-strategy", "list-style",
        "list-style-image", "list-style-position", "list-style-type", "margin",
        "margin-bottom", "margin-left", "margin-right", "margin-top",
        "marker-offset", "marks", "marquee-direction", "marquee-loop",
        "marquee-play-count", "marquee-speed", "marquee-style", "max-height",
        "max-width", "min-height", "min-width", "move-to", "nav-down", "nav-index",
        "nav-left", "nav-right", "nav-up", "opacity", "order", "orphans", "outline",
        "outline-color", "outline-offset", "outline-style", "outline-width",
        "overflow", "overflow-style", "overflow-wrap", "overflow-x", "overflow-y",
        "padding", "padding-bottom", "padding-left", "padding-right", "padding-top",
        "page", "page-break-after", "page-break-before", "page-break-inside",
        "page-policy", "pause", "pause-after", "pause-before", "perspective",
        "perspective-origin", "pitch", "pitch-range", "play-during", "position",
        "presentation-level", "punctuation-trim", "quotes", "region-break-after",
        "region-break-before", "region-break-inside", "region-fragment",
        "rendering-intent", "resize", "rest", "rest-after", "rest-before", "richness",
        "right", "rotation", "rotation-point", "ruby-align", "ruby-overhang",
        "ruby-position", "ruby-span", "shape-inside", "shape-outside", "size",
        "speak", "speak-as", "speak-header",
        "speak-numeral", "speak-punctuation", "speech-rate", "stress", "string-set",
        "tab-size", "table-layout", "target", "target-name", "target-new",
        "target-position", "text-align", "text-align-last", "text-decoration",
        "text-decoration-color", "text-decoration-line", "text-decoration-skip",
        "text-decoration-style", "text-emphasis", "text-emphasis-color",
        "text-emphasis-position", "text-emphasis-style", "text-height",
        "text-indent", "text-justify", "text-outline", "text-overflow", "text-shadow",
        "text-size-adjust", "text-space-collapse", "text-transform", "text-underline-position",
        "text-wrap", "top", "transform", "transform-origin", "transform-style",
        "transition", "transition-delay", "transition-duration",
        "transition-property", "transition-timing-function", "unicode-bidi",
        "vertical-align", "visibility", "voice-balance", "voice-duration",
        "voice-family", "voice-pitch", "voice-range", "voice-rate", "voice-stress",
        "voice-volume", "volume", "white-space", "widows", "width", "word-break",
        "word-spacing", "word-wrap", "z-index",
        // SVG-specific
        "clip-path", "clip-rule", "mask", "enable-background", "filter", "flood-color",
        "flood-opacity", "lighting-color", "stop-color", "stop-opacity", "pointer-events",
        "color-interpolation", "color-interpolation-filters",
        "color-rendering", "fill", "fill-opacity", "fill-rule", "image-rendering",
        "marker", "marker-end", "marker-mid", "marker-start", "shape-rendering", "stroke",
        "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin",
        "stroke-miterlimit", "stroke-opacity", "stroke-width", "text-rendering",
        "baseline-shift", "dominant-baseline", "glyph-orientation-horizontal",
        "glyph-orientation-vertical", "text-anchor", "writing-mode"
    ], propertyKeywords = keySet(propertyKeywords_);

    var nonStandardPropertyKeywords = [
        "scrollbar-arrow-color", "scrollbar-base-color", "scrollbar-dark-shadow-color",
        "scrollbar-face-color", "scrollbar-highlight-color", "scrollbar-shadow-color",
        "scrollbar-3d-light-color", "scrollbar-track-color", "shape-inside",
        "searchfield-cancel-button", "searchfield-decoration", "searchfield-results-button",
        "searchfield-results-decoration", "zoom"
    ], nonStandardPropertyKeywords = keySet(nonStandardPropertyKeywords);

    var colorKeywords_ = [
        "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige",
        "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown",
        "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue",
        "cornsilk", "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod",
        "darkgray", "darkgreen", "darkkhaki", "darkmagenta", "darkolivegreen",
        "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
        "darkslateblue", "darkslategray", "darkturquoise", "darkviolet",
        "deeppink", "deepskyblue", "dimgray", "dodgerblue", "firebrick",
        "floralwhite", "forestgreen", "fuchsia", "gainsboro", "ghostwhite",
        "gold", "goldenrod", "gray", "grey", "green", "greenyellow", "honeydew",
        "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
        "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral",
        "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightpink",
        "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray",
        "lightsteelblue", "lightyellow", "lime", "limegreen", "linen", "magenta",
        "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple",
        "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise",
        "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin",
        "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange", "orangered",
        "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred",
        "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue",
        "purple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon",
        "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue",
        "slateblue", "slategray", "snow", "springgreen", "steelblue", "tan",
        "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white",
        "whitesmoke", "yellow", "yellowgreen"
    ], colorKeywords = keySet(colorKeywords_);

    var valueKeywords_ = [
        "above", "absolute", "activeborder", "activecaption", "afar",
        "after-white-space", "ahead", "alias", "all", "all-scroll", "alternate",
        "always", "amharic", "amharic-abegede", "antialiased", "appworkspace",
        "arabic-indic", "armenian", "asterisks", "auto", "avoid", "avoid-column", "avoid-page",
        "avoid-region", "background", "backwards", "baseline", "below", "bidi-override", "binary",
        "bengali", "blink", "block", "block-axis", "bold", "bolder", "border", "border-box",
        "both", "bottom", "break", "break-all", "break-word", "button", "button-bevel",
        "buttonface", "buttonhighlight", "buttonshadow", "buttontext", "cambodian",
        "capitalize", "caps-lock-indicator", "caption", "captiontext", "caret",
        "cell", "center", "checkbox", "circle", "cjk-earthly-branch",
        "cjk-heavenly-stem", "cjk-ideographic", "clear", "clip", "close-quote",
        "col-resize", "collapse", "column", "compact", "condensed", "contain", "content",
        "content-box", "context-menu", "continuous", "copy", "cover", "crop",
        "cross", "crosshair", "currentcolor", "cursive", "dashed", "decimal",
        "decimal-leading-zero", "default", "default-button", "destination-atop",
        "destination-in", "destination-out", "destination-over", "devanagari",
        "disc", "discard", "document", "dot-dash", "dot-dot-dash", "dotted",
        "double", "down", "e-resize", "ease", "ease-in", "ease-in-out", "ease-out",
        "element", "ellipse", "ellipsis", "embed", "end", "ethiopic", "ethiopic-abegede",
        "ethiopic-abegede-am-et", "ethiopic-abegede-gez", "ethiopic-abegede-ti-er",
        "ethiopic-abegede-ti-et", "ethiopic-halehame-aa-er",
        "ethiopic-halehame-aa-et", "ethiopic-halehame-am-et",
        "ethiopic-halehame-gez", "ethiopic-halehame-om-et",
        "ethiopic-halehame-sid-et", "ethiopic-halehame-so-et",
        "ethiopic-halehame-ti-er", "ethiopic-halehame-ti-et",
        "ethiopic-halehame-tig", "ew-resize", "expanded", "extra-condensed",
        "extra-expanded", "fantasy", "fast", "fill", "fixed", "flat", "footnotes",
        "forwards", "from", "geometricPrecision", "georgian", "graytext", "groove",
        "gujarati", "gurmukhi", "hand", "hangul", "hangul-consonant", "hebrew",
        "help", "hidden", "hide", "higher", "highlight", "highlighttext",
        "hiragana", "hiragana-iroha", "horizontal", "hsl", "hsla", "icon", "ignore",
        "inactiveborder", "inactivecaption", "inactivecaptiontext", "infinite",
        "infobackground", "infotext", "inherit", "initial", "inline", "inline-axis",
        "inline-block", "inline-table", "inset", "inside", "intrinsic", "invert",
        "italic", "justify", "kannada", "katakana", "katakana-iroha", "keep-all", "khmer",
        "landscape", "lao", "large", "larger", "left", "level", "lighter",
        "line-through", "linear", "lines", "list-item", "listbox", "listitem",
        "local", "logical", "loud", "lower", "lower-alpha", "lower-armenian",
        "lower-greek", "lower-hexadecimal", "lower-latin", "lower-norwegian",
        "lower-roman", "lowercase", "ltr", "malayalam", "match",
        "media-controls-background", "media-current-time-display",
        "media-fullscreen-button", "media-mute-button", "media-play-button",
        "media-return-to-realtime-button", "media-rewind-button",
        "media-seek-back-button", "media-seek-forward-button", "media-slider",
        "media-sliderthumb", "media-time-remaining-display", "media-volume-slider",
        "media-volume-slider-container", "media-volume-sliderthumb", "medium",
        "menu", "menulist", "menulist-button", "menulist-text",
        "menulist-textfield", "menutext", "message-box", "middle", "min-intrinsic",
        "mix", "mongolian", "monospace", "move", "multiple", "myanmar", "n-resize",
        "narrower", "ne-resize", "nesw-resize", "no-close-quote", "no-drop",
        "no-open-quote", "no-repeat", "none", "normal", "not-allowed", "nowrap",
        "ns-resize", "nw-resize", "nwse-resize", "oblique", "octal", "open-quote",
        "optimizeLegibility", "optimizeSpeed", "oriya", "oromo", "outset",
        "outside", "outside-shape", "overlay", "overline", "padding", "padding-box",
        "painted", "page", "paused", "persian", "plus-darker", "plus-lighter", "pointer",
        "polygon", "portrait", "pre", "pre-line", "pre-wrap", "preserve-3d", "progress", "push-button",
        "radio", "read-only", "read-write", "read-write-plaintext-only", "rectangle", "region",
        "relative", "repeat", "repeat-x", "repeat-y", "reset", "reverse", "rgb", "rgba",
        "ridge", "right", "round", "row-resize", "rtl", "run-in", "running",
        "s-resize", "sans-serif", "scroll", "scrollbar", "se-resize", "searchfield",
        "searchfield-cancel-button", "searchfield-decoration",
        "searchfield-results-button", "searchfield-results-decoration",
        "semi-condensed", "semi-expanded", "separate", "serif", "show", "sidama",
        "single", "skip-white-space", "slide", "slider-horizontal",
        "slider-vertical", "sliderthumb-horizontal", "sliderthumb-vertical", "slow",
        "small", "small-caps", "small-caption", "smaller", "solid", "somali",
        "source-atop", "source-in", "source-out", "source-over", "space", "square",
        "square-button", "start", "static", "status-bar", "stretch", "stroke",
        "sub", "subpixel-antialiased", "super", "sw-resize", "table",
        "table-caption", "table-cell", "table-column", "table-column-group",
        "table-footer-group", "table-header-group", "table-row", "table-row-group",
        "telugu", "text", "text-bottom", "text-top", "textarea", "textfield", "thai",
        "thick", "thin", "threeddarkshadow", "threedface", "threedhighlight",
        "threedlightshadow", "threedshadow", "tibetan", "tigre", "tigrinya-er",
        "tigrinya-er-abegede", "tigrinya-et", "tigrinya-et-abegede", "to", "top",
        "transparent", "ultra-condensed", "ultra-expanded", "underline", "up",
        "upper-alpha", "upper-armenian", "upper-greek", "upper-hexadecimal",
        "upper-latin", "upper-norwegian", "upper-roman", "uppercase", "urdu", "url",
        "vertical", "vertical-text", "visible", "visibleFill", "visiblePainted",
        "visibleStroke", "visual", "w-resize", "wait", "wave", "wider",
        "window", "windowframe", "windowtext", "x-large", "x-small", "xor",
        "xx-large", "xx-small"
    ], valueKeywords = keySet(valueKeywords_);

    var fontProperties_ = [
        "font-family", "src", "unicode-range", "font-variant", "font-feature-settings",
        "font-stretch", "font-weight", "font-style"
    ], fontProperties = keySet(fontProperties_);

    var allWords = mediaTypes_.concat(mediaFeatures_).concat(propertyKeywords_)
            .concat(nonStandardPropertyKeywords).concat(colorKeywords_).concat(valueKeywords_);
    CodeMirror.registerHelper("hintWords", "css", allWords);

    function tokenCComment(stream, state) {
        var maybeEnd = false, ch;
        while ((ch = stream.next()) != null) {
            if (maybeEnd && ch == "/") {
                state.tokenize = null;
                break;
            }
            maybeEnd = (ch == "*");
        }
        return ["comment", "comment"];
    }

    function tokenSGMLComment(stream, state) {
        if (stream.skipTo("-->")) {
            stream.match("-->");
            state.tokenize = null;
        } else {
            stream.skipToEnd();
        }
        return ["comment", "comment"];
    }

    CodeMirror.defineMIME("text/css", {
        mediaTypes: mediaTypes,
        mediaFeatures: mediaFeatures,
        propertyKeywords: propertyKeywords,
        nonStandardPropertyKeywords: nonStandardPropertyKeywords,
        colorKeywords: colorKeywords,
        valueKeywords: valueKeywords,
        fontProperties: fontProperties,
        tokenHooks: {
            "<": function (stream, state) {
                if (!stream.match("!--"))
                    return false;
                state.tokenize = tokenSGMLComment;
                return tokenSGMLComment(stream, state);
            },
            "/": function (stream, state) {
                if (!stream.eat("*"))
                    return false;
                state.tokenize = tokenCComment;
                return tokenCComment(stream, state);
            }
        },
        name: "css"
    });

    CodeMirror.defineMIME("text/x-scss", {
        mediaTypes: mediaTypes,
        mediaFeatures: mediaFeatures,
        propertyKeywords: propertyKeywords,
        nonStandardPropertyKeywords: nonStandardPropertyKeywords,
        colorKeywords: colorKeywords,
        valueKeywords: valueKeywords,
        fontProperties: fontProperties,
        allowNested: true,
        tokenHooks: {
            "/": function (stream, state) {
                if (stream.eat("/")) {
                    stream.skipToEnd();
                    return ["comment", "comment"];
                } else if (stream.eat("*")) {
                    state.tokenize = tokenCComment;
                    return tokenCComment(stream, state);
                } else {
                    return ["operator", "operator"];
                }
            },
            ":": function (stream) {
                if (stream.match(/\s*{/))
                    return [null, "{"];
                return false;
            },
            "$": function (stream) {
                stream.match(/^[\w-]+/);
                if (stream.match(/^\s*:/, false))
                    return ["variable-2", "variable-definition"];
                return ["variable-2", "variable"];
            },
            "#": function (stream) {
                if (!stream.eat("{"))
                    return false;
                return [null, "interpolation"];
            }
        },
        name: "css",
        helperType: "scss"
    });

    CodeMirror.defineMIME("text/x-less", {
        mediaTypes: mediaTypes,
        mediaFeatures: mediaFeatures,
        propertyKeywords: propertyKeywords,
        nonStandardPropertyKeywords: nonStandardPropertyKeywords,
        colorKeywords: colorKeywords,
        valueKeywords: valueKeywords,
        fontProperties: fontProperties,
        allowNested: true,
        tokenHooks: {
            "/": function (stream, state) {
                if (stream.eat("/")) {
                    stream.skipToEnd();
                    return ["comment", "comment"];
                } else if (stream.eat("*")) {
                    state.tokenize = tokenCComment;
                    return tokenCComment(stream, state);
                } else {
                    return ["operator", "operator"];
                }
            },
            "@": function (stream) {
                if (stream.match(/^(charset|document|font-face|import|(-(moz|ms|o|webkit)-)?keyframes|media|namespace|page|supports)\b/, false))
                    return false;
                stream.eatWhile(/[\w\\\-]/);
                if (stream.match(/^\s*:/, false))
                    return ["variable-2", "variable-definition"];
                return ["variable-2", "variable"];
            },
            "&": function () {
                return ["atom", "atom"];
            }
        },
        name: "css",
        helperType: "less"
    });

});
;(function (mod) {

    mod(CodeMirror);
})(function (CodeMirror) {
    "use strict";

    CodeMirror.defineMode("clike", function (config, parserConfig) {
        var indentUnit = config.indentUnit,
                statementIndentUnit = parserConfig.statementIndentUnit || indentUnit,
                dontAlignCalls = parserConfig.dontAlignCalls,
                keywords = parserConfig.keywords || {},
                builtin = parserConfig.builtin || {},
                blockKeywords = parserConfig.blockKeywords || {},
                atoms = parserConfig.atoms || {},
                hooks = parserConfig.hooks || {},
                multiLineStrings = parserConfig.multiLineStrings;
        var isOperatorChar = /[+\-*&%=<>!?|\/]/;

        var curPunc;

        function tokenBase(stream, state) {
            var ch = stream.next();
            if (hooks[ch]) {
                var result = hooks[ch](stream, state);
                if (result !== false)
                    return result;
            }
            if (ch == '"' || ch == "'") {
                state.tokenize = tokenString(ch);
                return state.tokenize(stream, state);
            }
            if (/[\[\]{}\(\),;\:\.]/.test(ch)) {
                curPunc = ch;
                return null;
            }
            if (/\d/.test(ch)) {
                stream.eatWhile(/[\w\.]/);
                return "number";
            }
            if (ch == "/") {
                if (stream.eat("*")) {
                    state.tokenize = tokenComment;
                    return tokenComment(stream, state);
                }
                if (stream.eat("/")) {
                    stream.skipToEnd();
                    return "comment";
                }
            }
            if (isOperatorChar.test(ch)) {
                stream.eatWhile(isOperatorChar);
                return "operator";
            }
            stream.eatWhile(/[\w\$_]/);
            var cur = stream.current();
            if (keywords.propertyIsEnumerable(cur)) {
                if (blockKeywords.propertyIsEnumerable(cur))
                    curPunc = "newstatement";
                return "keyword";
            }
            if (builtin.propertyIsEnumerable(cur)) {
                if (blockKeywords.propertyIsEnumerable(cur))
                    curPunc = "newstatement";
                return "builtin";
            }
            if (atoms.propertyIsEnumerable(cur))
                return "atom";
            return "variable";
        }

        function tokenString(quote) {
            return function (stream, state) {
                var escaped = false, next, end = false;
                while ((next = stream.next()) != null) {
                    if (next == quote && !escaped) {
                        end = true;
                        break;
                    }
                    escaped = !escaped && next == "\\";
                }
                if (end || !(escaped || multiLineStrings))
                    state.tokenize = null;
                return "string";
            };
        }

        function tokenComment(stream, state) {
            var maybeEnd = false, ch;
            while (ch = stream.next()) {
                if (ch == "/" && maybeEnd) {
                    state.tokenize = null;
                    break;
                }
                maybeEnd = (ch == "*");
            }
            return "comment";
        }

        function Context(indented, column, type, align, prev) {
            this.indented = indented;
            this.column = column;
            this.type = type;
            this.align = align;
            this.prev = prev;
        }
        function pushContext(state, col, type) {
            var indent = state.indented;
            if (state.context && state.context.type == "statement")
                indent = state.context.indented;
            return state.context = new Context(indent, col, type, null, state.context);
        }
        function popContext(state) {
            var t = state.context.type;
            if (t == ")" || t == "]" || t == "}")
                state.indented = state.context.indented;
            return state.context = state.context.prev;
        }

        // Interface

        return {
            startState: function (basecolumn) {
                return {
                    tokenize: null,
                    context: new Context((basecolumn || 0) - indentUnit, 0, "top", false),
                    indented: 0,
                    startOfLine: true
                };
            },
            token: function (stream, state) {
                var ctx = state.context;
                if (stream.sol()) {
                    if (ctx.align == null)
                        ctx.align = false;
                    state.indented = stream.indentation();
                    state.startOfLine = true;
                }
                if (stream.eatSpace())
                    return null;
                curPunc = null;
                var style = (state.tokenize || tokenBase)(stream, state);
                if (style == "comment" || style == "meta")
                    return style;
                if (ctx.align == null)
                    ctx.align = true;

                if ((curPunc == ";" || curPunc == ":" || curPunc == ",") && ctx.type == "statement")
                    popContext(state);
                else if (curPunc == "{")
                    pushContext(state, stream.column(), "}");
                else if (curPunc == "[")
                    pushContext(state, stream.column(), "]");
                else if (curPunc == "(")
                    pushContext(state, stream.column(), ")");
                else if (curPunc == "}") {
                    while (ctx.type == "statement")
                        ctx = popContext(state);
                    if (ctx.type == "}")
                        ctx = popContext(state);
                    while (ctx.type == "statement")
                        ctx = popContext(state);
                } else if (curPunc == ctx.type)
                    popContext(state);
                else if (((ctx.type == "}" || ctx.type == "top") && curPunc != ';') || (ctx.type == "statement" && curPunc == "newstatement"))
                    pushContext(state, stream.column(), "statement");
                state.startOfLine = false;
                return style;
            },
            indent: function (state, textAfter) {
                if (state.tokenize != tokenBase && state.tokenize != null)
                    return CodeMirror.Pass;
                var ctx = state.context, firstChar = textAfter && textAfter.charAt(0);
                if (ctx.type == "statement" && firstChar == "}")
                    ctx = ctx.prev;
                var closing = firstChar == ctx.type;
                if (ctx.type == "statement")
                    return ctx.indented + (firstChar == "{" ? 0 : statementIndentUnit);
                else if (ctx.align && (!dontAlignCalls || ctx.type != ")"))
                    return ctx.column + (closing ? 0 : 1);
                else if (ctx.type == ")" && !closing)
                    return ctx.indented + statementIndentUnit;
                else
                    return ctx.indented + (closing ? 0 : indentUnit);
            },
            electricChars: "{}",
            blockCommentStart: "/*",
            blockCommentEnd: "*/",
            lineComment: "//",
            fold: "brace"
        };
    });

    function words(str) {
        var obj = {}, words = str.split(" ");
        for (var i = 0; i < words.length; ++i)
            obj[words[i]] = true;
        return obj;
    }
    var cKeywords = "auto if break int case long char register continue return default short do sizeof " +
            "double static else struct entry switch extern typedef float union for unsigned " +
            "goto while enum void const signed volatile";

    function cppHook(stream, state) {
        if (!state.startOfLine)
            return false;
        for (; ; ) {
            if (stream.skipTo("\\")) {
                stream.next();
                if (stream.eol()) {
                    state.tokenize = cppHook;
                    break;
                }
            } else {
                stream.skipToEnd();
                state.tokenize = null;
                break;
            }
        }
        return "meta";
    }

    function cpp11StringHook(stream, state) {
        stream.backUp(1);
        // Raw strings.
        if (stream.match(/(R|u8R|uR|UR|LR)/)) {
            var match = stream.match(/"(.{0,16})\(/);
            if (!match) {
                return false;
            }
            state.cpp11RawStringDelim = match[1];
            state.tokenize = tokenRawString;
            return tokenRawString(stream, state);
        }
        // Unicode strings/chars.
        if (stream.match(/(u8|u|U|L)/)) {
            if (stream.match(/["']/, /* eat */ false)) {
                return "string";
            }
            return false;
        }
        // Ignore this hook.
        stream.next();
        return false;
    }

    // C#-style strings where "" escapes a quote.
    function tokenAtString(stream, state) {
        var next;
        while ((next = stream.next()) != null) {
            if (next == '"' && !stream.eat('"')) {
                state.tokenize = null;
                break;
            }
        }
        return "string";
    }

    // C++11 raw string literal is <prefix>"<delim>( anything )<delim>", where
    // <delim> can be a string up to 16 characters long.
    function tokenRawString(stream, state) {
        var closingSequence = new RegExp(".*?\\)" + state.cpp11RawStringDelim + '"');
        var match = stream.match(closingSequence);
        if (match) {
            state.tokenize = null;
        } else {
            stream.skipToEnd();
        }
        return "string";
    }

    function def(mimes, mode) {
        if (typeof mimes == "string")
            mimes = [mimes];
        var words = [];
        function add(obj) {
            if (obj)
                for (var prop in obj)
                    if (obj.hasOwnProperty(prop))
                        words.push(prop);
        }
        add(mode.keywords);
        add(mode.builtin);
        add(mode.atoms);
        if (words.length) {
            mode.helperType = mimes[0];
            CodeMirror.registerHelper("hintWords", mimes[0], words);
        }

        for (var i = 0; i < mimes.length; ++i)
            CodeMirror.defineMIME(mimes[i], mode);
    }

    def(["text/x-csrc", "text/x-c", "text/x-chdr"], {
        name: "clike",
        keywords: words(cKeywords),
        blockKeywords: words("case do else for if switch while struct"),
        atoms: words("null"),
        hooks: {"#": cppHook},
        modeProps: {fold: ["brace", "include"]}
    });

    def(["text/x-c++src", "text/x-c++hdr"], {
        name: "clike",
        keywords: words(cKeywords + " asm dynamic_cast namespace reinterpret_cast try bool explicit new " +
                "static_cast typeid catch operator template typename class friend private " +
                "this using const_cast inline public throw virtual delete mutable protected " +
                "wchar_t alignas alignof constexpr decltype nullptr noexcept thread_local final " +
                "static_assert override"),
        blockKeywords: words("catch class do else finally for if struct switch try while"),
        atoms: words("true false null"),
        hooks: {
            "#": cppHook,
            "u": cpp11StringHook,
            "U": cpp11StringHook,
            "L": cpp11StringHook,
            "R": cpp11StringHook
        },
        modeProps: {fold: ["brace", "include"]}
    });
    def("text/x-java", {
        name: "clike",
        keywords: words("abstract assert boolean break byte case catch char class const continue default " +
                "do double else enum extends final finally float for goto if implements import " +
                "instanceof int interface long native new package private protected public " +
                "return short static strictfp super switch synchronized this throw throws transient " +
                "try void volatile while"),
        blockKeywords: words("catch class do else finally for if switch try while"),
        atoms: words("true false null"),
        hooks: {
            "@": function (stream) {
                stream.eatWhile(/[\w\$_]/);
                return "meta";
            }
        },
        modeProps: {fold: ["brace", "import"]}
    });
    def("text/x-csharp", {
        name: "clike",
        keywords: words("abstract as base break case catch checked class const continue" +
                " default delegate do else enum event explicit extern finally fixed for" +
                " foreach goto if implicit in interface internal is lock namespace new" +
                " operator out override params private protected public readonly ref return sealed" +
                " sizeof stackalloc static struct switch this throw try typeof unchecked" +
                " unsafe using virtual void volatile while add alias ascending descending dynamic from get" +
                " global group into join let orderby partial remove select set value var yield"),
        blockKeywords: words("catch class do else finally for foreach if struct switch try while"),
        builtin: words("Boolean Byte Char DateTime DateTimeOffset Decimal Double" +
                " Guid Int16 Int32 Int64 Object SByte Single String TimeSpan UInt16 UInt32" +
                " UInt64 bool byte char decimal double short int long object" +
                " sbyte float string ushort uint ulong"),
        atoms: words("true false null"),
        hooks: {
            "@": function (stream, state) {
                if (stream.eat('"')) {
                    state.tokenize = tokenAtString;
                    return tokenAtString(stream, state);
                }
                stream.eatWhile(/[\w\$_]/);
                return "meta";
            }
        }
    });
    def("text/x-scala", {
        name: "clike",
        keywords: words(
                /* scala */
                "abstract case catch class def do else extends false final finally for forSome if " +
                "implicit import lazy match new null object override package private protected return " +
                "sealed super this throw trait try trye type val var while with yield _ : = => <- <: " +
                "<% >: # @ " +
                /* package scala */
                "assert assume require print println printf readLine readBoolean readByte readShort " +
                "readChar readInt readLong readFloat readDouble " +
                "AnyVal App Application Array BufferedIterator BigDecimal BigInt Char Console Either " +
                "Enumeration Equiv Error Exception Fractional Function IndexedSeq Integral Iterable " +
                "Iterator List Map Numeric Nil NotNull Option Ordered Ordering PartialFunction PartialOrdering " +
                "Product Proxy Range Responder Seq Serializable Set Specializable Stream StringBuilder " +
                "StringContext Symbol Throwable Traversable TraversableOnce Tuple Unit Vector :: #:: " +
                /* package java.lang */
                "Boolean Byte Character CharSequence Class ClassLoader Cloneable Comparable " +
                "Compiler Double Exception Float Integer Long Math Number Object Package Pair Process " +
                "Runtime Runnable SecurityManager Short StackTraceElement StrictMath String " +
                "StringBuffer System Thread ThreadGroup ThreadLocal Throwable Triple Void"


                ),
        blockKeywords: words("catch class do else finally for forSome if match switch try while"),
        atoms: words("true false null"),
        hooks: {
            "@": function (stream) {
                stream.eatWhile(/[\w\$_]/);
                return "meta";
            }
        }
    });
    def(["x-shader/x-vertex", "x-shader/x-fragment"], {
        name: "clike",
        keywords: words("float int bool void " +
                "vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 " +
                "mat2 mat3 mat4 " +
                "sampler1D sampler2D sampler3D samplerCube " +
                "sampler1DShadow sampler2DShadow" +
                "const attribute uniform varying " +
                "break continue discard return " +
                "for while do if else struct " +
                "in out inout"),
        blockKeywords: words("for while do if else struct"),
        builtin: words("radians degrees sin cos tan asin acos atan " +
                "pow exp log exp2 sqrt inversesqrt " +
                "abs sign floor ceil fract mod min max clamp mix step smootstep " +
                "length distance dot cross normalize ftransform faceforward " +
                "reflect refract matrixCompMult " +
                "lessThan lessThanEqual greaterThan greaterThanEqual " +
                "equal notEqual any all not " +
                "texture1D texture1DProj texture1DLod texture1DProjLod " +
                "texture2D texture2DProj texture2DLod texture2DProjLod " +
                "texture3D texture3DProj texture3DLod texture3DProjLod " +
                "textureCube textureCubeLod " +
                "shadow1D shadow2D shadow1DProj shadow2DProj " +
                "shadow1DLod shadow2DLod shadow1DProjLod shadow2DProjLod " +
                "dFdx dFdy fwidth " +
                "noise1 noise2 noise3 noise4"),
        atoms: words("true false " +
                "gl_FragColor gl_SecondaryColor gl_Normal gl_Vertex " +
                "gl_MultiTexCoord0 gl_MultiTexCoord1 gl_MultiTexCoord2 gl_MultiTexCoord3 " +
                "gl_MultiTexCoord4 gl_MultiTexCoord5 gl_MultiTexCoord6 gl_MultiTexCoord7 " +
                "gl_FogCoord " +
                "gl_Position gl_PointSize gl_ClipVertex " +
                "gl_FrontColor gl_BackColor gl_FrontSecondaryColor gl_BackSecondaryColor " +
                "gl_TexCoord gl_FogFragCoord " +
                "gl_FragCoord gl_FrontFacing " +
                "gl_FragColor gl_FragData gl_FragDepth " +
                "gl_ModelViewMatrix gl_ProjectionMatrix gl_ModelViewProjectionMatrix " +
                "gl_TextureMatrix gl_NormalMatrix gl_ModelViewMatrixInverse " +
                "gl_ProjectionMatrixInverse gl_ModelViewProjectionMatrixInverse " +
                "gl_TexureMatrixTranspose gl_ModelViewMatrixInverseTranspose " +
                "gl_ProjectionMatrixInverseTranspose " +
                "gl_ModelViewProjectionMatrixInverseTranspose " +
                "gl_TextureMatrixInverseTranspose " +
                "gl_NormalScale gl_DepthRange gl_ClipPlane " +
                "gl_Point gl_FrontMaterial gl_BackMaterial gl_LightSource gl_LightModel " +
                "gl_FrontLightModelProduct gl_BackLightModelProduct " +
                "gl_TextureColor gl_EyePlaneS gl_EyePlaneT gl_EyePlaneR gl_EyePlaneQ " +
                "gl_FogParameters " +
                "gl_MaxLights gl_MaxClipPlanes gl_MaxTextureUnits gl_MaxTextureCoords " +
                "gl_MaxVertexAttribs gl_MaxVertexUniformComponents gl_MaxVaryingFloats " +
                "gl_MaxVertexTextureImageUnits gl_MaxTextureImageUnits " +
                "gl_MaxFragmentUniformComponents gl_MaxCombineTextureImageUnits " +
                "gl_MaxDrawBuffers"),
        hooks: {"#": cppHook},
        modeProps: {fold: ["brace", "include"]}
    });

});
;(function (mod) {

    mod(CodeMirror);
})(function (CodeMirror) {
    "use strict";

    function keywords(str) {
        var obj = {}, words = str.split(" ");
        for (var i = 0; i < words.length; ++i)
            obj[words[i]] = true;
        return obj;
    }
    function heredoc(delim) {
        return function (stream, state) {
            if (stream.match(delim))
                state.tokenize = null;
            else
                stream.skipToEnd();
            return "string";
        };
    }

    // Helper for stringWithEscapes
    function matchSequence(list) {
        if (list.length == 0)
            return stringWithEscapes;
        return function (stream, state) {
            var patterns = list[0];
            for (var i = 0; i < patterns.length; i++)
                if (stream.match(patterns[i][0])) {
                    state.tokenize = matchSequence(list.slice(1));
                    return patterns[i][1];
                }
            state.tokenize = stringWithEscapes;
            return "string";
        };
    }
    function stringWithEscapes(stream, state) {
        var escaped = false, next, end = false;

        if (stream.current() == '"')
            return "string";

        // "Complex" syntax
        if (stream.match("${", false) || stream.match("{$", false)) {
            state.tokenize = null;
            return "string";
        }

        // Simple syntax
        if (stream.match(/\$[a-zA-Z_][a-zA-Z0-9_]*/)) {
            // After the variable name there may appear array or object operator.
            if (stream.match("[", false)) {
                // Match array operator
                state.tokenize = matchSequence([
                    [["[", null]],
                    [[/\d[\w\.]*/, "number"],
                        [/\$[a-zA-Z_][a-zA-Z0-9_]*/, "variable-2"],
                        [/[\w\$]+/, "variable"]],
                    [["]", null]]
                ]);
            }
            if (stream.match(/\-\>\w/, false)) {
                // Match object operator
                state.tokenize = matchSequence([
                    [["->", null]],
                    [[/[\w]+/, "variable"]]
                ]);
            }
            return "variable-2";
        }

        // Normal string
        while (
                !stream.eol() &&
                (!stream.match("{$", false)) &&
                (!stream.match(/(\$[a-zA-Z_][a-zA-Z0-9_]*|\$\{)/, false) || escaped)
                ) {
            next = stream.next();
            if (!escaped && next == '"') {
                end = true;
                break;
            }
            escaped = !escaped && next == "\\";
        }
        if (end) {
            state.tokenize = null;
            state.phpEncapsStack.pop();
        }
        return "string";
    }

    var phpKeywords = "abstract and array as break case catch class clone const continue declare default " +
            "do else elseif enddeclare endfor endforeach endif endswitch endwhile extends final " +
            "for foreach function global goto if implements interface instanceof namespace " +
            "new or private protected public static switch throw trait try use var while xor " +
            "die echo empty exit eval include include_once isset list require require_once return " +
            "print unset __halt_compiler self static parent yield insteadof finally";
    var phpAtoms = "true false null TRUE FALSE NULL __CLASS__ __DIR__ __FILE__ __LINE__ __METHOD__ __FUNCTION__ __NAMESPACE__ __TRAIT__";
    var phpBuiltin = "func_num_args func_get_arg func_get_args strlen strcmp strncmp strcasecmp strncasecmp each error_reporting define defined trigger_error user_error set_error_handler restore_error_handler get_declared_classes get_loaded_extensions extension_loaded get_extension_funcs debug_backtrace constant bin2hex hex2bin sleep usleep time mktime gmmktime strftime gmstrftime strtotime date gmdate getdate localtime checkdate flush wordwrap htmlspecialchars htmlentities html_entity_decode md5 md5_file crc32 getimagesize image_type_to_mime_type phpinfo phpversion phpcredits strnatcmp strnatcasecmp substr_count strspn strcspn strtok strtoupper strtolower strpos strrpos strrev hebrev hebrevc nl2br basename dirname pathinfo stripslashes stripcslashes strstr stristr strrchr str_shuffle str_word_count strcoll substr substr_replace quotemeta ucfirst ucwords strtr addslashes addcslashes rtrim str_replace str_repeat count_chars chunk_split trim ltrim strip_tags similar_text explode implode setlocale localeconv parse_str str_pad chop strchr sprintf printf vprintf vsprintf sscanf fscanf parse_url urlencode urldecode rawurlencode rawurldecode readlink linkinfo link unlink exec system escapeshellcmd escapeshellarg passthru shell_exec proc_open proc_close rand srand getrandmax mt_rand mt_srand mt_getrandmax base64_decode base64_encode abs ceil floor round is_finite is_nan is_infinite bindec hexdec octdec decbin decoct dechex base_convert number_format fmod ip2long long2ip getenv putenv getopt microtime gettimeofday getrusage uniqid quoted_printable_decode set_time_limit get_cfg_var magic_quotes_runtime set_magic_quotes_runtime get_magic_quotes_gpc get_magic_quotes_runtime import_request_variables error_log serialize unserialize memory_get_usage var_dump var_export debug_zval_dump print_r highlight_file show_source highlight_string ini_get ini_get_all ini_set ini_alter ini_restore get_include_path set_include_path restore_include_path setcookie header headers_sent connection_aborted connection_status ignore_user_abort parse_ini_file is_uploaded_file move_uploaded_file intval floatval doubleval strval gettype settype is_null is_resource is_bool is_long is_float is_int is_integer is_double is_real is_numeric is_string is_array is_object is_scalar ereg ereg_replace eregi eregi_replace split spliti join sql_regcase dl pclose popen readfile rewind rmdir umask fclose feof fgetc fgets fgetss fread fopen fpassthru ftruncate fstat fseek ftell fflush fwrite fputs mkdir rename copy tempnam tmpfile file file_get_contents stream_select stream_context_create stream_context_set_params stream_context_set_option stream_context_get_options stream_filter_prepend stream_filter_append fgetcsv flock get_meta_tags stream_set_write_buffer set_file_buffer set_socket_blocking stream_set_blocking socket_set_blocking stream_get_meta_data stream_register_wrapper stream_wrapper_register stream_set_timeout socket_set_timeout socket_get_status realpath fnmatch fsockopen pfsockopen pack unpack get_browser crypt opendir closedir chdir getcwd rewinddir readdir dir glob fileatime filectime filegroup fileinode filemtime fileowner fileperms filesize filetype file_exists is_writable is_writeable is_readable is_executable is_file is_dir is_link stat lstat chown touch clearstatcache mail ob_start ob_flush ob_clean ob_end_flush ob_end_clean ob_get_flush ob_get_clean ob_get_length ob_get_level ob_get_status ob_get_contents ob_implicit_flush ob_list_handlers ksort krsort natsort natcasesort asort arsort sort rsort usort uasort uksort shuffle array_walk count end prev next reset current key min max in_array array_search extract compact array_fill range array_multisort array_push array_pop array_shift array_unshift array_splice array_slice array_merge array_merge_recursive array_keys array_values array_count_values array_reverse array_reduce array_pad array_flip array_change_key_case array_rand array_unique array_intersect array_intersect_assoc array_diff array_diff_assoc array_sum array_filter array_map array_chunk array_key_exists pos sizeof key_exists assert assert_options version_compare ftok str_rot13 aggregate session_name session_module_name session_save_path session_id session_regenerate_id session_decode session_register session_unregister session_is_registered session_encode session_start session_destroy session_unset session_set_save_handler session_cache_limiter session_cache_expire session_set_cookie_params session_get_cookie_params session_write_close preg_match preg_match_all preg_replace preg_replace_callback preg_split preg_quote preg_grep overload ctype_alnum ctype_alpha ctype_cntrl ctype_digit ctype_lower ctype_graph ctype_print ctype_punct ctype_space ctype_upper ctype_xdigit virtual apache_request_headers apache_note apache_lookup_uri apache_child_terminate apache_setenv apache_response_headers apache_get_version getallheaders mysql_connect mysql_pconnect mysql_close mysql_select_db mysql_create_db mysql_drop_db mysql_query mysql_unbuffered_query mysql_db_query mysql_list_dbs mysql_list_tables mysql_list_fields mysql_list_processes mysql_error mysql_errno mysql_affected_rows mysql_insert_id mysql_result mysql_num_rows mysql_num_fields mysql_fetch_row mysql_fetch_array mysql_fetch_assoc mysql_fetch_object mysql_data_seek mysql_fetch_lengths mysql_fetch_field mysql_field_seek mysql_free_result mysql_field_name mysql_field_table mysql_field_len mysql_field_type mysql_field_flags mysql_escape_string mysql_real_escape_string mysql_stat mysql_thread_id mysql_client_encoding mysql_get_client_info mysql_get_host_info mysql_get_proto_info mysql_get_server_info mysql_info mysql mysql_fieldname mysql_fieldtable mysql_fieldlen mysql_fieldtype mysql_fieldflags mysql_selectdb mysql_createdb mysql_dropdb mysql_freeresult mysql_numfields mysql_numrows mysql_listdbs mysql_listtables mysql_listfields mysql_db_name mysql_dbname mysql_tablename mysql_table_name pg_connect pg_pconnect pg_close pg_connection_status pg_connection_busy pg_connection_reset pg_host pg_dbname pg_port pg_tty pg_options pg_ping pg_query pg_send_query pg_cancel_query pg_fetch_result pg_fetch_row pg_fetch_assoc pg_fetch_array pg_fetch_object pg_fetch_all pg_affected_rows pg_get_result pg_result_seek pg_result_status pg_free_result pg_last_oid pg_num_rows pg_num_fields pg_field_name pg_field_num pg_field_size pg_field_type pg_field_prtlen pg_field_is_null pg_get_notify pg_get_pid pg_result_error pg_last_error pg_last_notice pg_put_line pg_end_copy pg_copy_to pg_copy_from pg_trace pg_untrace pg_lo_create pg_lo_unlink pg_lo_open pg_lo_close pg_lo_read pg_lo_write pg_lo_read_all pg_lo_import pg_lo_export pg_lo_seek pg_lo_tell pg_escape_string pg_escape_bytea pg_unescape_bytea pg_client_encoding pg_set_client_encoding pg_meta_data pg_convert pg_insert pg_update pg_delete pg_select pg_exec pg_getlastoid pg_cmdtuples pg_errormessage pg_numrows pg_numfields pg_fieldname pg_fieldsize pg_fieldtype pg_fieldnum pg_fieldprtlen pg_fieldisnull pg_freeresult pg_result pg_loreadall pg_locreate pg_lounlink pg_loopen pg_loclose pg_loread pg_lowrite pg_loimport pg_loexport http_response_code get_declared_traits getimagesizefromstring socket_import_stream stream_set_chunk_size trait_exists header_register_callback class_uses session_status session_register_shutdown echo print global static exit array empty eval isset unset die include require include_once require_once";
    CodeMirror.registerHelper("hintWords", "php", [phpKeywords, phpAtoms, phpBuiltin].join(" ").split(" "));

    var phpConfig = {
        name: "clike",
        helperType: "php",
        keywords: keywords(phpKeywords),
        blockKeywords: keywords("catch do else elseif for foreach if switch try while finally"),
        atoms: keywords(phpAtoms),
        builtin: keywords(phpBuiltin),
        multiLineStrings: true,
        hooks: {
            "$": function (stream) {
                stream.eatWhile(/[\w\$_]/);
                return "variable-2";
            },
            "<": function (stream, state) {
                if (stream.match(/<</)) {
                    stream.eatWhile(/[\w\.]/);
                    state.tokenize = heredoc(stream.current().slice(3));
                    return state.tokenize(stream, state);
                }
                return false;
            },
            "#": function (stream) {
                while (!stream.eol() && !stream.match("?>", false))
                    stream.next();
                return "comment";
            },
            "/": function (stream) {
                if (stream.eat("/")) {
                    while (!stream.eol() && !stream.match("?>", false))
                        stream.next();
                    return "comment";
                }
                return false;
            },
            '"': function (stream, state) {
                if (!state.phpEncapsStack)
                    state.phpEncapsStack = [];
                state.phpEncapsStack.push(0);
                state.tokenize = stringWithEscapes;
                return state.tokenize(stream, state);
            },
            "{": function (_stream, state) {
                if (state.phpEncapsStack && state.phpEncapsStack.length > 0)
                    state.phpEncapsStack[state.phpEncapsStack.length - 1]++;
                return false;
            },
            "}": function (_stream, state) {
                if (state.phpEncapsStack && state.phpEncapsStack.length > 0)
                    if (--state.phpEncapsStack[state.phpEncapsStack.length - 1] == 0)
                        state.tokenize = stringWithEscapes;
                return false;
            }
        }
    };

    CodeMirror.defineMode("php", function (config, parserConfig) {
        var htmlMode = CodeMirror.getMode(config, "text/html");
        var phpMode = CodeMirror.getMode(config, phpConfig);

        function dispatch(stream, state) {
            var isPHP = state.curMode == phpMode;
            if (stream.sol() && state.pending && state.pending != '"' && state.pending != "'")
                state.pending = null;
            if (!isPHP) {
                if (stream.match(/^<\?\w*/)) {
                    state.curMode = phpMode;
                    state.curState = state.php;
                    return "meta";
                }
                if (state.pending == '"' || state.pending == "'") {
                    while (!stream.eol() && stream.next() != state.pending) {
                    }
                    var style = "string";
                } else if (state.pending && stream.pos < state.pending.end) {
                    stream.pos = state.pending.end;
                    var style = state.pending.style;
                } else {
                    var style = htmlMode.token(stream, state.curState);
                }
                if (state.pending)
                    state.pending = null;
                var cur = stream.current(), openPHP = cur.search(/<\?/), m;
                if (openPHP != -1) {
                    if (style == "string" && (m = cur.match(/[\'\"]$/)) && !/\?>/.test(cur))
                        state.pending = m[0];
                    else
                        state.pending = {end: stream.pos, style: style};
                    stream.backUp(cur.length - openPHP);
                }
                return style;
            } else if (isPHP && state.php.tokenize == null && stream.match("?>")) {
                state.curMode = htmlMode;
                state.curState = state.html;
                return "meta";
            } else {
                var result = phpMode.token(stream, state.curState);
                return (stream.pos <= stream.start) ? phpMode.token(stream, state.curState) : result;
            }
        }

        return {
            startState: function () {
                var html = CodeMirror.startState(htmlMode), php = CodeMirror.startState(phpMode);
                return {html: html,
                    php: php,
                    curMode: parserConfig.startOpen ? phpMode : htmlMode,
                    curState: parserConfig.startOpen ? php : html,
                    pending: null};
            },
            copyState: function (state) {
                var html = state.html, htmlNew = CodeMirror.copyState(htmlMode, html),
                        php = state.php, phpNew = CodeMirror.copyState(phpMode, php), cur;
                if (state.curMode == htmlMode)
                    cur = htmlNew;
                else
                    cur = phpNew;
                return {html: htmlNew, php: phpNew, curMode: state.curMode, curState: cur,
                    pending: state.pending};
            },
            token: dispatch,
            indent: function (state, textAfter) {
                if ((state.curMode != phpMode && /^\s*<\//.test(textAfter)) ||
                        (state.curMode == phpMode && /^\?>/.test(textAfter)))
                    return htmlMode.indent(state.html, textAfter);
                return state.curMode.indent(state.curState, textAfter);
            },
            blockCommentStart: "/*",
            blockCommentEnd: "*/",
            lineComment: "//",
            innerMode: function (state) {
                return {state: state.curState, mode: state.curMode};
            }
        };
    }, "htmlmixed", "clike");

    CodeMirror.defineMIME("application/x-httpd-php", "php");
    CodeMirror.defineMIME("application/x-httpd-php-open", {name: "php", startOpen: true});
    CodeMirror.defineMIME("text/x-php", phpConfig);
});
;/**
 * Copyright © 2015 Wyomind. All rights reserved.
 * See LICENSE.txt for license details.
 */

DataFeedManager = {
    configuration: {
        current_type: "xml",
        current_value: 1,
        CodeMirrorTxt: null,
        updateType: function (automatic) {
            var manual = false;
            if (automatic) {   
                // si type selectionne = XML et precedent != XML => on passe de csv a xml
                if (DataFeedManager.configuration.current_type != DataFeedManager.configuration.getType()) {
                    manual = confirm("Changing file type from/to xml will clear all your settings. Do you want to continue ?");
                    if (!manual) {
                        jQuery('#type').val(DataFeedManager.configuration.current_value);
                    }
                }
            }
            if (manual || !automatic) {
                var list1 = new Array("header", "product_pattern", "footer", "clean_data", "enclose_data");
                var list2 = new Array("extra_header", "include_header", "extra_footer", "field_separator", "field_protector", "field_escape");
                var list3 = new Array("header", "product_pattern", "footer", "extra_header", "extra_footer");
                
                DataFeedManager.configuration.current_type = DataFeedManager.configuration.getType();
                DataFeedManager.configuration.current_value = jQuery("#type").val();

                if (manual) { // seulement si changement manuel
                    // empty all text field
                    list3.each(function(id) {
                        jQuery('#' + id).val("");
                    });
                    
                    if (DataFeedManager.configuration.isXML()) {
                        jQuery("#fields").remove();
                    }
                }

                if (!DataFeedManager.configuration.isXML()) { // others
                    list1.each(function (id) {
                        jQuery('#' + id).parent().parent().css({display: 'none'});
                    });
                    list2.each(function (id) {
                        jQuery('#' + id).parent().parent().css({display: 'block'});
                    });
                    DataFeedManager.configuration.displayTxtTemplate();
                } else { // XML
                    list1.each(function (id) {
                        jQuery('#' + id).parent().parent().css({display: 'block'});
                    });
                    list2.each(function (id) {
                        jQuery('#' + id).parent().parent().css({display: 'none'});
                    });
                }
                
                if (manual) {
                    CodeMirrorProductPattern.setValue('');
                    CodeMirrorHeaderPattern.setValue('');
                    CodeMirrorFooterPattern.setValue('');
                    CodeMirrorProductPattern.refresh();
                    CodeMirrorHeaderPattern.refresh();
                    CodeMirrorFooterPattern.refresh();
                }
                

            }
            


        },
        getType: function () {
            if (jQuery('#type').val() == 1)
                return "xml";
            else
                return "txt";
        },
        isXML: function (type) {
            if (typeof type == "undefined") {
                return jQuery('#type').val() == 1;
            } else {
                return type == 1;
            }
        },
        displayTxtTemplate: function () {
            if (jQuery("#fields").length == 0) {
                var content = "<div id='fields'>";
                content += "     Column name";
                content += "      <span style='margin-left:96px'>Pattern</span>";
                content += "<ul class='fields-list' id='fields-list'></ul>";
                content += "<button type='button' class='add-field' onclick='DataFeedManager.configuration.addField(\"\",\"\",true)'>Insert a new field</button>";
                content += "<div class='overlay-txtTemplate'>\n\
                            <div class='container-txtTemplate'> \n\
                            <textarea id='codemirror-txtTemplate'>&nbsp;</textarea>\n\
                            <button type='button' class='validate' onclick='DataFeedManager.configuration.popup.validate()'>Validate</button>\n\
                            <button type='button' class='cancel' onclick='DataFeedManager.configuration.popup.close()'>Cancel</button>\n\
                            </div>\n\
                            </div>";
                content += "</div>";
                jQuery(content).insertAfter("#include_header");

                DataFeedManager.configuration.CodeMirrorTxt = CodeMirror.fromTextArea(document.getElementById('codemirror-txtTemplate'), {
                    matchBrackets: true,
                    mode: "application/x-httpd-php",
                    indentUnit: 2,
                    indentWithTabs: false,
                    lineWrapping: true,
                    lineNumbers: false,
                    styleActiveLine: true
                });
                
                jQuery("#fields-list").sortable({
                    revert: true,
                    axis: "y",
                    stop: function () {
                        DataFeedManager.configuration.fieldsToJson();
                    }
                });
                
                DataFeedManager.configuration.jsonToFields();
            }

        },
        addField: function (header, body, refresh) {
            content = "<li class='txt-fields'>";
            content += "   <input class='txt-field  header-txt-field input-text ' type='text' value=\"" + header.replace(/"/g, "&quot;") + "\"/>";
            content += "   <input class='txt-field  body-txt-field input-text ' type='text' value=\"" + body.replace(/"/g, "&quot;") + "\"/>";
            content += "   <button class='txt-field remove-field ' onclick='DataFeedManager.configuration.removeField(this)' >\u2716</button>";
            content += "</li>";
            jQuery("#fields-list").append(content);
            if (refresh)
                DataFeedManager.configuration.fieldsToJson();
        },
        removeField: function (elt) {
            jQuery(elt).parents('li').remove();
            DataFeedManager.configuration.fieldsToJson();
        },
        fieldsToJson: function () {
            var data = new Object;
            data.header = new Array;
            c = 0;
            jQuery('INPUT.header-txt-field').each(function () {
                data.header[c] = jQuery(this).val();
                c++;
            });
            data.body = new Array;
            c = 0;
            jQuery('INPUT.body-txt-field').each(function () {
                data.body[c] = jQuery(this).val();
                c++;
            });
            var pattern = '{"product":' + JSON.stringify(data.body) + "}";
            var header = '{"header":' + JSON.stringify(data.header) + "}";
            jQuery("#product_pattern").val(pattern);
            jQuery("#header").val(header);
            CodeMirrorProductPattern.setValue(pattern);
            CodeMirrorHeaderPattern.setValue(header);
            CodeMirrorProductPattern.refresh();
            CodeMirrorHeaderPattern.refresh();
        },
        jsonToFields: function () {
            var data = new Object;
            
            var header = [];
            if (jQuery('#header').val() != '') {
                try {
                    header = jQuery.parseJSON(jQuery('#header').val()).header;
                } catch (e) {
                    header = [];
                }
            }

            var body = [];
            if (jQuery('#product_pattern').val() != '') {
                try {
                    body = jQuery.parseJSON(jQuery('#product_pattern').val()).product;
                } catch (e) {
                    body = [];
                }
            }

            data.header = header;
            data.body = body;

            i = 0;
            data.body.each(function () {
                DataFeedManager.configuration.addField(data.header[i], data.body[i], false);
                i++;
            });
        },
        popup: {
            current: null,
            close: function () {
                jQuery(".overlay-txtTemplate").css({"display": "none"});
            },
            validate: function () {
                jQuery(DataFeedManager.configuration.popup.current).val(DataFeedManager.configuration.CodeMirrorTxt.getValue());
                DataFeedManager.configuration.popup.current = null;
                DataFeedManager.configuration.popup.close();
                DataFeedManager.configuration.fieldsToJson();
            },
            open: function (content, field) {
                jQuery(".overlay-txtTemplate").css({"display": "block"});
                DataFeedManager.configuration.CodeMirrorTxt.refresh();
                DataFeedManager.configuration.CodeMirrorTxt.setValue(content);
                DataFeedManager.configuration.popup.current = field;
                DataFeedManager.configuration.CodeMirrorTxt.focus();
            }
        }
    },
    /**
     * All about categories selection/filter
     */
    categories: {
        /**
         * Update the selected categories
         * @returns {undefined}
         */
        updateSelection: function () {
            var selection = {};
            jQuery('input.category').each(function () {
                var elt = jQuery(this);
                var id = elt.attr('id').replace('cat_id_', '');
                var mapping = jQuery('#category_mapping_' + id).val();
                selection[id] = {c: (jQuery(this).prop('checked') === true ? '1' : '0'), m: mapping};
            });
            jQuery('#categories').val(JSON.stringify(selection));

        },
        /**
         * Select all children categories
         * @param {type} elt
         * @returns {undefined}
         */
        selectChildren: function (elt) {
            var checked = elt.prop('checked');
            elt.parent().parent().find('input.category').each(function () {
                if (checked)
                    jQuery(this).parent().addClass('selected');
                else
                    jQuery(this).parent().removeClass('selected');
                jQuery(this).prop('checked', checked);
            });
        },
        /**
         * Init the categories tree from the model data
         * @returns {undefined}
         */
        loadCategories: function () {
            var cats = jQuery('#categories').val();
            if (cats === "") {
                jQuery('#categories').val('*');
                cats = '*';
            }
            if (cats === "*")
                return;
            var sel = jQuery.parseJSON(cats);
            for (var i in sel) {
                if (sel[i]['c'] == "1") {
                    // select the category
                    jQuery('#cat_id_' + i).prop('checked', true);
                    jQuery('#cat_id_' + i).parent().addClass('selected');
                    // open the tv-switcher for all previous level
                    jQuery('#cat_id_' + i).parent().parent().parent().addClass('opened').removeClass('closed');
                    var path = jQuery('#cat_id_' + i).attr('parent_id').split('/');
                    path.each(function (j) {
                        jQuery('#cat_id_' + j).parent().parent().parent().addClass('opened').removeClass('closed');
                        jQuery('#cat_id_' + j).prev().addClass('opened').removeClass('closed');
                    });
                }
                // set the category mapping
                jQuery('#category_mapping_' + i).val(sel[i]['m']);
            }
        },
        /**
         * Load the categories filter (exclude/include)
         * @returns {undefined}
         */
        loadCategoriesFilter: function () {
            if (jQuery("#category_filter").val() == "") {
                jQuery("#category_filter").val(1);
            }
            if (jQuery("#category_type").val() == "") {
                jQuery("#category_type").val(0);
            }
            jQuery('#category_filter_' + jQuery("#category_filter").val()).prop('checked', true);
            jQuery('#category_type_' + jQuery("#category_type").val()).prop('checked', true);
        },
        /**
         * Update all children with the parent mapping
         * @param {type} mapping
         * @returns {undefined}
         */
        updateChildrenMapping: function (mapping) {
            mapping.parent().parent().parent().find('input.mapping').each(function () {
                jQuery(this).val(mapping.val());
            });
            DataFeedManager.categories.updateSelection();
        },
        /**
         * Initialiaz autocomplete fields for the mapping
         * @returns {undefined}
         */
        initAutoComplete: function () {
            jQuery('.mapping').each(function () {
                jQuery(this).autocomplete({
                    source: jQuery('#categories_url').val() + "?file=" + jQuery('#feed_taxonomy').val(),
                    minLength: 2,
                    select: function (event, ui) {
                        DataFeedManager.categories.updateSelection();
                    }
                });
            });
        },
        /**
         * Reinit the autocomple fields with a new taxonomy file
         * @returns {undefined}
         */
        updateAutoComplete: function () {
            jQuery('.mapping').each(function () {
                jQuery(this).autocomplete("option", "source", jQuery('#categories_url').val() + "?file=" + jQuery('#feed_taxonomy').val());
            });
        }
    },
    /**
     * All about filters
     */
    filters: {
        /**
         * Load the selected product types
         * @returns {undefined}
         */
        loadProductTypes: function () {
            var values = jQuery('#type_ids').val();
            if (jQuery('#type_ids').val() === "") {
                jQuery('#type_ids').val('*');
                values = '*';
            }
            if (values !== '*') {
                values = values.split(',');
                values.each(function (v) {
                    jQuery('#type_id_' + v).prop('checked', true);
                    jQuery('#type_id_' + v).parent().addClass('selected');
                });
            } else {
                jQuery('#type-ids-selector').find('input').each(function () {
                    jQuery(this).prop('checked', true);
                    jQuery(this).parent().addClass('selected');
                });
            }
        },
        /**
         * Check if all product types are selected
         * @returns {Boolean}
         */
        isAllProductTypesSelected: function () {
            var all = true;
            jQuery(document).find('.filter_product_type').each(function () {
                if (jQuery(this).prop('checked') === false)
                    all = false;
            });
            return all;
        },
        /**
         * Update product types selection
         * @returns {undefined}
         */
        updateProductTypes: function () {
            var values = new Array();
            jQuery('.filter_product_type').each(function (i) {
                if (jQuery(this).prop('checked')) {
                    values.push(jQuery(this).attr('identifier'));
                }
            });
            jQuery('#type_ids').val(values.join());
            DataFeedManager.filters.updateUnSelectLinksProductTypes();
        },
        /**
         * Load the selected atribute set
         * @returns {undefined}
         */
        loadAttributeSets: function () {
            var values = jQuery('#attribute_sets').val();
            if (jQuery('#attribute_sets').val() === "") {
                jQuery('#attribute_sets').val('*');
                values = '*';
            }
            if (values != '*') {
                values = values.split(',');
                values.each(function (v) {
                    jQuery('#attribute_set_' + v).prop('checked', true);
                    jQuery('#attribute_set_' + v).parent().addClass('selected');
                });
            } else {
                jQuery('#attribute-sets-selector').find('input').each(function () {
                    jQuery(this).prop('checked', true);
                    jQuery(this).parent().addClass('selected');
                });
            }
        },
        /**
         * Update attribute sets selection
         * @returns {undefined}
         */
        updateAttributeSets: function () {
            var values = new Array();
            var all = true;
            jQuery('.filter_attribute_set').each(function (i) {
                if (jQuery(this).prop('checked')) {
                    values.push(jQuery(this).attr('identifier'));
                } else {
                    all = false;
                }
            });
            if (all) {
                jQuery('#attribute_sets').val('*');
            } else {
                jQuery('#attribute_sets').val(values.join());
            }
            DataFeedManager.filters.updateUnSelectLinksAttributeSets();
        },
        /**
         * Check if all attribute sets are selected
         * @returns {Boolean}
         */
        isAllAttributeSetsSelected: function () {
            var all = true;
            jQuery(document).find('.filter_attribute_set').each(function () {
                if (jQuery(this).prop('checked') === false)
                    all = false;
            });
            return all;
        },
        /**
         * Load the selected product visibilities
         * @returns {undefined}
         */
        loadProductVisibilities: function () {
            var values = jQuery('#visibilities').val();
            if (jQuery('#visibilities').val() === '') {
                jQuery('#visibilities').val('*');
                values = '*';
            }
            if (values !== '*') {
                values = values.split(',');
                values.each(function (v) {
                    jQuery('#visibility_' + v).prop('checked', true);
                    jQuery('#visibility_' + v).parent().addClass('selected');
                });
            } else {
                jQuery('#visibility-selector').find('input').each(function () {
                    jQuery(this).prop('checked', true);
                    jQuery(this).parent().addClass('selected');
                });
            }
        },
        /**
         * Update visibilities selection
         * @returns {undefined}
         */
        updateProductVisibilities: function () {
            var values = new Array();
            //var all = true;
            jQuery('.filter_visibility').each(function (i) {
                if (jQuery(this).prop('checked')) {
                    values.push(jQuery(this).attr('identifier'));
                }/* else {
                 all = false;
                 }*/
            });
            /*if (all)
             jQuery('#visibilities').val('*');
             else*/
            jQuery('#visibilities').val(values.join());
            DataFeedManager.filters.updateUnSelectLinksProductVisibilities();
        },
        /**
         * Check if all product visibilities are selected
         * @returns {Boolean}
         */
        isAllProductVisibilitiesSelected: function () {
            var all = true;
            jQuery(document).find('.filter_visibility').each(function () {
                if (jQuery(this).prop('checked') === false)
                    all = false;
            });
            return all;
        },
        /**
         * Check if we need to display 'Select All' or 'Unselect All' for each kind of filters
         * @returns {undefined}
         */
        updateUnSelectLinks: function () {
            DataFeedManager.filters.updateUnSelectLinksProductTypes();
            DataFeedManager.filters.updateUnSelectLinksAttributeSets();
            DataFeedManager.filters.updateUnSelectLinksProductVisibilities();
        },
        /**
         * Check if we need to display 'Select All' or 'Unselect All' for product types
         * @returns {undefined}
         */
        updateUnSelectLinksProductTypes: function () {
            if (DataFeedManager.filters.isAllProductTypesSelected()) {
                jQuery('#type-ids-selector').find('.select-all').removeClass('visible');
                jQuery('#type-ids-selector').find('.unselect-all').addClass('visible');
            } else {
                jQuery('#type-ids-selector').find('.select-all').addClass('visible');
                jQuery('#type-ids-selector').find('.unselect-all').removeClass('visible');
            }
        },
        /**
         * Check if we need to display 'Select All' or 'Unselect All' for attributes sets
         * @returns {undefined}
         */
        updateUnSelectLinksAttributeSets: function () {
            if (DataFeedManager.filters.isAllAttributeSetsSelected()) {
                jQuery('#attribute-sets-selector').find('.select-all').removeClass('visible');
                jQuery('#attribute-sets-selector').find('.unselect-all').addClass('visible');
            } else {
                jQuery('#attribute-sets-selector').find('.select-all').addClass('visible');
                jQuery('#attribute-sets-selector').find('.unselect-all').removeClass('visible');
            }
        },
        /**
         * Check if we need to display 'Select All' or 'Unselect All' for product visibilities
         * @returns {undefined}
         */
        updateUnSelectLinksProductVisibilities: function () {
            if (DataFeedManager.filters.isAllProductVisibilitiesSelected()) {
                jQuery('#visibility-selector').find('.select-all').removeClass('visible');
                jQuery('#visibility-selector').find('.unselect-all').addClass('visible');
            } else {
                jQuery('#visibility-selector').find('.select-all').addClass('visible');
                jQuery('#visibility-selector').find('.unselect-all').removeClass('visible');
            }
        },
        /**
         * Load the selected advanced filters
         * @returns {undefined}
         */
        loadAdvancedFilters: function () {
            var filters = jQuery.parseJSON(jQuery('#attributes').val());
            if (filters === null) {
                filters = new Array();
                jQuery('#attributes').val(JSON.stringify(filters));
            }
            var counter = 0;
            while (filters[counter]) {
                filter = filters[counter];
                jQuery('#attribute_' + counter).prop('checked', filter.checked);

                jQuery('#name_attribute_' + counter).val(filter.code);
                jQuery('#value_attribute_' + counter).val(filter.value);
                jQuery('#condition_attribute_' + counter).val(filter.condition);
                if (filter.statement) {
                    jQuery('#statement_attribute_' + counter).val(filter.statement);
                }

                DataFeedManager.filters.updateRow(counter, filter.code);

                jQuery('#name_attribute_' + counter).prop('disabled', !filter.checked);
                jQuery('#condition_attribute_' + counter).prop('disabled', !filter.checked);
                jQuery('#value_attribute_' + counter).prop('disabled', !filter.checked);
                jQuery('#pre_value_attribute_' + counter).prop('disabled', !filter.checked);
                jQuery('#statement_attribute_' + counter).prop('disabled', !filter.checked);


                jQuery('#pre_value_attribute_' + counter).val(filter.value);

                counter++;
            }
        },
        /**
         * Update the advanced filters json string
         * @returns {undefined}
         */
        updateAdvancedFilters: function () {
            var newval = {};
            var counter = 0;
            jQuery('.advanced_filters').each(function () {
                var checkbox = jQuery(this).find('#attribute_' + counter).prop('checked');
                // is the row activated
                if (checkbox) {
                    jQuery('#name_attribute_' + counter).prop('disabled', false);
                    jQuery('#condition_attribute_' + counter).prop('disabled', false);
                    jQuery('#value_attribute_' + counter).prop('disabled', false);
                    jQuery('#pre_value_attribute_' + counter).prop('disabled', false);
                    jQuery('#statement_attribute_' + counter).prop('disabled', false);
                } else {
                    jQuery('#name_attribute_' + counter).prop('disabled', true);
                    jQuery('#condition_attribute_' + counter).prop('disabled', true);
                    jQuery('#value_attribute_' + counter).prop('disabled', true);
                    jQuery('#pre_value_attribute_' + counter).prop('disabled', true);
                    jQuery('#statement_attribute_' + counter).prop('disabled', true);
                }
                var statement = jQuery(this).find('#statement_attribute_' + counter).val();
                var name = jQuery(this).find('#name_attribute_' + counter).val();
                var condition = jQuery(this).find('#condition_attribute_' + counter).val();
                var pre_value = jQuery(this).find('#pre_value_attribute_' + counter).val();
                var value = jQuery(this).find('#value_attribute_' + counter).val();
                if (attribute_codes[name] && attribute_codes[name].length > 0) {
                    value = pre_value;
                }
                var val = {checked: checkbox, code: name, statement: statement, condition: condition, value: value};
                newval[counter] = val;
                counter++;
            });
            jQuery('#attributes').val(JSON.stringify(newval));
        },
        /**
         * Update an advanced filter row (display custom value or not, display multi select, ...)
         * @param {type} id
         * @param {type} attribute_code
         * @returns {undefined}
         */
        updateRow: function (id, attribute_code) {
            if (attribute_codes[attribute_code] && attribute_codes[attribute_code].length > 0) {

                // enable multi select or dropdown
                jQuery('#pre_value_attribute_' + id).prop('disabled', false);

                // full the multi select / dropdown
                jQuery('#pre_value_attribute_' + id).html("");
                attribute_codes[attribute_code].each(function (elt) {

                    jQuery('#pre_value_attribute_' + id).append(jQuery('<option>', {
                        value: elt.value,
                        text: elt.label
                    }));
                });
                jQuery('#pre_value_attribute_' + id).val(attribute_codes[attribute_code][0].value);


                // if "in/not in", then multiselect
                if (jQuery('#condition_attribute_' + id).val() === "in" || jQuery('#condition_attribute_' + id).val() === "nin") {
                    jQuery('#pre_value_attribute_' + id).attr('size', '5');
                    jQuery('#pre_value_attribute_' + id).prop('multiple', true);
                    jQuery('#name_attribute_' + id).parent().parent().parent().parent().addClass('multiple-value').removeClass('one-value').removeClass('dddw');
                    jQuery('#value_attribute_' + id).css('display', 'none');

                } else if (jQuery('#condition_attribute_' + id).val() === "null" || jQuery('#condition_attribute_' + id).val() === "notnull") {
                    jQuery('#name_attribute_' + id).parent().parent().parent().parent().removeClass('multiple-value').addClass('one-value').removeClass('dddw');
                    jQuery('#value_attribute_' + id).css('display', 'none');

                } else { // else, dropdown
                    jQuery('#pre_value_attribute_' + id).prop('size', '1');
                    jQuery('#pre_value_attribute_' + id).prop('multiple', false);
                    jQuery('#name_attribute_' + id).parent().parent().parent().parent().removeClass('multiple-value').addClass('one-value').addClass('dddw');
                    jQuery('#value_attribute_' + id).css('display', 'none');
                }



            } else {
                jQuery('#name_attribute_' + id).parent().parent().parent().parent().removeClass('multiple-value').addClass('one-value').removeClass('dddw');
                jQuery('#pre_value_attribute_' + id).prop('disabled', true);
                if (jQuery('#condition_attribute_' + id).val() === "null" || jQuery('#condition_attribute_' + id).val() === "notnull") {
                    jQuery('#value_attribute_' + id).css('display', 'none');
                } else {
                    jQuery('#value_attribute_' + id).css('display', 'inline');
                }
            }
        },
        /**
         * Click on select all link
         * @param {type} elt
         * @returns {undefined}
         */
        selectAll: function (elt) {
            var fieldset = elt.parents('.fieldset')[0];
            jQuery(fieldset).find('input[type=checkbox]').each(function () {
                jQuery(this).prop('checked', true);
                jQuery(this).parent().addClass('selected');
            });
            DataFeedManager.filters.updateProductTypes();
            DataFeedManager.filters.updateProductVisibilities();
            DataFeedManager.filters.updateAttributeSets();
            elt.removeClass('visible');
            jQuery(fieldset).find('.unselect-all').addClass('visible');
        },
        /**
         * Click on unselect all link
         * @param {type} elt
         * @returns {undefined}
         */
        unselectAll: function (elt) {
            var fieldset = elt.parents('.fieldset')[0];
            jQuery(fieldset).find('input[type=checkbox]').each(function () {
                jQuery(this).prop('checked', false);
                jQuery(this).parent().removeClass('selected');
            });
            DataFeedManager.filters.updateProductTypes();
            DataFeedManager.filters.updateProductVisibilities();
            DataFeedManager.filters.updateAttributeSets();
            elt.removeClass('visible');
            jQuery(fieldset).find('.select-all').addClass('visible');
        }
    },
    /**
     * All about Preview/Library boxes
     */
    boxes: {
        library: false,
        preview: false,
        init: function () {
            /* maxter box */
            jQuery('<div/>', {
                id: 'master-box',
                class: 'master-box'
            }).appendTo('#html-body');

            /* preview tag */
            jQuery('<div/>', {
                id: 'preview-tag',
                class: 'preview-tag box-tag'
            }).appendTo('#html-body');
            jQuery('<div/>', {
                text: jQuery.mage.__('Preview')
            }).appendTo('#preview-tag');

            /* library tag */
            jQuery('<div/>', {
                id: 'library-tag',
                class: 'library-tag box-tag'
            }).appendTo('#html-body');
            jQuery('<div/>', {
                text: jQuery.mage.__('Library')
            }).appendTo('#library-tag');

            /* preview tab */
            jQuery('<div/>', {// preview master box
                id: 'preview-master-box',
                class: 'preview-master-box visible'
            }).appendTo('#master-box');
            jQuery('<span/>', {// refresh button
                id: 'preview-refresh-btn',
                class: 'preview-refresh-btn',
                html: '<span class="preview-refresh-btn-icon"> </span> <span>' + jQuery.mage.__('Refresh the preview') + '</span>'
            }).appendTo('#preview-master-box');


            jQuery('<textarea/>', {// preview content
                id: 'preview-area',
                class: 'preview-area'
            }).appendTo('#preview-master-box');
            jQuery('<div/>', {// preview content
                id: 'preview-table-area',
                class: 'preview-table-area'
            }).appendTo('#preview-master-box');
            jQuery('<div/>', {// loader 
                id: 'preview-box-loader',
                class: 'box-loader',
                html: '<div class="ajax-loader"></load>'
            }).appendTo('#preview-master-box');


            /* library tab */
            jQuery('<div/>', {// library master box
                id: 'library-master-box',
                class: 'library-master-box visible'
            }).appendTo('#master-box');

            jQuery('<div/>', {// loader 
                id: 'library-box-loader',
                class: 'box-loader',
                html: '<div class="ajax-loader"></load>'
            }).appendTo('#library-master-box');

            jQuery('<div/>', {// library content
                id: 'library-area',
                class: 'library-area'
            }).appendTo('#library-master-box');

        },
        /**
         * Close the box
         * @returns {undefined}
         */
        close: function () {
            jQuery('.box-tag').each(function () {
                jQuery(this).removeClass('opened');
                jQuery(this).removeClass('selected');
            });
            jQuery('.master-box').removeClass('opened');
            jQuery('#library-master-box').removeClass('visible');
            jQuery('#preview-master-box').removeClass('visible');
        },
        /**
         * Open the preview box when no box opened
         * @returns {undefined}
         */
        openPreview: function () {
            jQuery("#preview-tag").addClass('selected');
            // translates tags
            jQuery('.box-tag').each(function () {
                jQuery(this).addClass('opened');
            });
            // translates main box
            jQuery('.master-box').addClass('opened');
            // on affiche le preview
            jQuery('#library-master-box').removeClass('visible');
            jQuery('#preview-master-box').addClass('visible');
        },
        /**
         * Open the library box when no box opened
         * @returns {undefined}
         */
        openLibrary: function () {
            jQuery("#library-tag").addClass('selected');
            // translate tags
            jQuery('.box-tag').each(function () {
                jQuery(this).addClass('opened');
            });
            // translates main box
            jQuery('.master-box').addClass('opened');
            // on affiche le preview
            jQuery('#library-master-box').addClass('visible');
            jQuery('#preview-master-box').removeClass('visible');
        },
        /**
         * Switch to the preview box
         * @returns {undefined}
         */
        switchToPreview: function () {
            jQuery('.box-tag').each(function () {
                jQuery(this).removeClass('selected');
            });
            jQuery("#preview-tag").addClass('selected');
            jQuery('#library-master-box').removeClass('visible');
            jQuery('#preview-master-box').addClass('visible');
        },
        /**
         * Switch to the library box
         * @returns {undefined}
         */
        switchToLibrary: function () {
            jQuery('.box-tag').each(function () {
                jQuery(this).removeClass('selected');
            });
            jQuery("#library-tag").addClass('selected');
            jQuery('#library-master-box').addClass('visible');
            jQuery('#preview-master-box').removeClass('visible');
        },
        /*
         * 
         * @returns {undefined}
         */
        hideLoaders: function () {
            jQuery(".box-loader").css("display", "none");
        },
        showLoader: function (name) {
            jQuery("#" + name + "-box-loader").css("display", "block");
        },
        /**
         * Refresh the preview
         * @returns {undefined}
         */
        refreshPreview: function () {
            if (!jQuery(this).hasClass('selected') && jQuery(this).hasClass('opened')) { // panneau ouvert sur library
                DataFeedManager.boxes.switchToPreview();
            } else if (jQuery(this).hasClass('selected') && jQuery(this).hasClass('opened')) { // panneau ouvert sur preview
                DataFeedManager.boxes.close();
            } else { // panneau non ouvert
                DataFeedManager.boxes.openPreview();
            }
            var requestUrl = jQuery('#sample_url').val();
            CodeMirrorPreview.setValue("");

            DataFeedManager.boxes.showLoader("preview");
            if (typeof request != "undefined") {
                request.abort();
            }
            request = jQuery.ajax({
                url: requestUrl,
                type: 'POST',
                showLoader: false,
                data: {
                    real_time_preview: true,    
                    id: jQuery('#id').val(),
                    encoding: jQuery('#encoding').val(),
                    delimiter: jQuery('#delimiter').val(),
                    store_id: jQuery('#store_id').val(),
                    enclose_data: jQuery('#enclose_data').val(),
                    clean_data: jQuery('#clean_data').val(),
                    include_header: jQuery('#include_header').val(),
                    field_delimiter: jQuery('#field_delimiter').val(),
                    field_protector: jQuery('#field_protector').val(),
                    field_escape: jQuery('#field_escape').val(),
                    extra_header: jQuery('#extra_header').val(),
                    product_pattern: jQuery('#product_pattern').val(),
                    header: jQuery('#header').val(),
                    footer: jQuery('#footer').val(),
                    extra_footer: jQuery('#extra_footer').val(),
                    categories: jQuery('#categories').val(),
                    category_filter: jQuery('#category_filter').val(),
                    category_type: jQuery('#category_type').val(),
                    type_ids: jQuery('#type_ids').val(),
                    visibilities: jQuery('#visibilities').val(),
                    attributes: jQuery('#attributes').val(),
                    attribute_sets: jQuery('#attribute_sets').val(),
                    type: jQuery('#type').val()
                },
                success: function (data) {                    
                    if (jQuery('#type').val() != 1) { // others
                        TablePreview.innerHTML = data.data;
                        jQuery(TablePreview).css({display: 'block'});
                    } else { // xml
                        TablePreview.innerHTML = null;
                        jQuery(TablePreview).css({display: 'none'});

                        CodeMirrorPreview.setValue(data.data);

                    }
                    DataFeedManager.boxes.hideLoaders()
                },
                error: function (xhr, status, error) {
                    if (typeof CodeMirrorPreview != 'undefined')
                        CodeMirrorPreview.toTextArea();
                    TablePreview.innerHTML = error;
                    jQuery(TablePreview).css({display: 'block'});
                    DataFeedManager.boxes.hideLoaders()

                }
            });
        },
        /**
         * Initialize the library boxe
         * @returns {undefined}
         */
        loadLibrary: function () {
            var requestUrl = jQuery('#library_url').val();
            DataFeedManager.boxes.showLoader("library");
            if (typeof request != "undefined") {
                request.abort();
            }
            request = jQuery.ajax({
                url: requestUrl,
                type: 'GET',
                showLoader: false,
                success: function (data) {
                    jQuery('#library-area').html(data);
                    DataFeedManager.boxes.hideLoaders();
                    DataFeedManager.boxes.library = true;
                }
            });
        },
        /**
         * Load a sample of product for an attribute in the library boxe
         * @param {type} elt
         * @returns {undefined}
         */
        loadLibrarySamples: function (elt) {
            var requestUrl = jQuery('#library_sample_url').val();
            var code = elt.attr('att_code');
            var store_id = jQuery('#store_id').val();


            if (elt.find('span').hasClass('opened')) {
                elt.find('span').addClass('closed').removeClass('opened');
                elt.parent().next().find('td').html("");
                elt.parent().next().removeClass('visible');
                return;
            }
            DataFeedManager.boxes.showLoader("library");
            if (typeof request != "undefined") {
                request.abort();
            }
            request = jQuery.ajax({
                url: requestUrl,
                data: {
                    code: code,
                    store_id: store_id
                },
                type: 'GET',
                showLoader: false,
                success: function (data) {
                    elt.parent().next().addClass('visible');

                    var html = "<table class='inner-attribute'>";
                    if (data.length > 0) {
                        data.each(function (elt) {
                            html += "<tr><td class='name'><b>" + elt.name + "</b><br/>" + elt.sku + "</td><td class='values'>" + elt.attribute + "<td></tr>";
                        });
                        html += "</table>";
                    } else {
                        html = jQuery.mage.__("No product found.");
                    }
                    elt.find('span').addClass('opened').removeClass('closed');
                    elt.parent().next().find('td').html(html);
                    DataFeedManager.boxes.hideLoaders();
                }
            });
        }
    },
    /**
     * All about cron tasks
     */
    cron: {
        /**
         * Load the selected days and hours
         */
        loadExpr: function () {
            if (jQuery('#cron_expr').val() == "") {
                jQuery('#cron_expr').val("{}");
            }
            var val = jQuery.parseJSON(jQuery('#cron_expr').val());
            if (val !== null) {
                if (val.days)
                    val.days.each(function (elt) {
                        jQuery('#d-' + elt).parent().addClass('selected');
                        jQuery('#d-' + elt).prop('checked', true);
                    });
                if (val.hours)
                    val.hours.each(function (elt) {
                        var hour = elt.replace(':', '');
                        jQuery('#h-' + hour).parent().addClass('selected');
                        jQuery('#h-' + hour).prop('checked', true);
                    });
            }
        },
        /**
         * Update the json representation of the cron schedule
         */
        updateExpr: function () {
            var days = new Array();
            var hours = new Array();
            jQuery('.cron-box.day').each(function () {
                if (jQuery(this).prop('checked') === true) {
                    days.push(jQuery(this).attr('value'));
                }
            });
            jQuery('.cron-box.hour').each(function () {
                if (jQuery(this).prop('checked') === true) {
                    hours.push(jQuery(this).attr('value'));
                }
            });

            jQuery('#cron_expr').val(JSON.stringify({days: days, hours: hours}));
        }
    },
    ftp : {
        test : function(url) {
            jQuery.ajax({
                url: url,
                data: {
                    ftp_host: jQuery('#ftp_host').val(),
                    ftp_port: jQuery('#ftp_port').val(),
                    ftp_login: jQuery('#ftp_login').val(),
                    ftp_password: jQuery('#ftp_password').val(),
                    ftp_dir: jQuery('#ftp_dir').val(),
                    ftp_active: jQuery('#ftp_active').val(),
                    use_sftp: jQuery('#use_sftp').val(),
                },
                type: 'POST',
                showLoader: true,
                success: function (data) {
                    alert(data);
                }
            });
        }
    }
};

var CodeMirrorProductPattern = null;
var CodeMirrorHeaderPattern = null;
var CodeMirrorFooterPattern = null;
var TablePreview = null;

window.onload = function () {


    require(["jquery", "mage/mage", "mage/translate"], function ($) {
        $(function () {

            /* ========= Config ========================= */

            /* template editor */

            CodeMirrorProductPattern = CodeMirror.fromTextArea(document.getElementById('product_pattern'), {
                matchBrackets: true,
                mode: "application/x-httpd-php",
                indentUnit: 2,
                indentWithTabs: false,
                lineWrapping: true,
                lineNumbers: true,
                styleActiveLine: true
            });
            
            
            CodeMirrorHeaderPattern = CodeMirror.fromTextArea(document.getElementById('header'), {
                matchBrackets: true,
                mode: "application/x-httpd-php",
                indentUnit: 2,
                indentWithTabs: false,
                lineWrapping: true,
                lineNumbers: true,
                styleActiveLine: true
            });
            CodeMirrorFooterPattern = CodeMirror.fromTextArea(document.getElementById('footer'), {
                matchBrackets: true,
                mode: "application/x-httpd-php",
                indentUnit: 2,
                indentWithTabs: false,
                lineWrapping: true,
                lineNumbers: true,
                styleActiveLine: true
            });


            // to be sure that the good value will be well stored in db
            CodeMirrorProductPattern.on('blur', function () {
                jQuery('#product_pattern').val(CodeMirrorProductPattern.getValue());
            });
            CodeMirrorHeaderPattern.on('blur', function () {
                jQuery('#header').val(CodeMirrorHeaderPattern.getValue());
            });
            CodeMirrorFooterPattern.on('blur', function () {
                jQuery('#footer').val(CodeMirrorFooterPattern.getValue());
            });

            jQuery('#type').on('change', function () {
                DataFeedManager.configuration.updateType(true);
            });
            DataFeedManager.configuration.updateType(false);

            jQuery(document).on('focus', ".body-txt-field   ", function () {
                DataFeedManager.configuration.popup.open(jQuery(this).val(), this);
            });
            
            jQuery(document).on('focus', ".header-txt-field", function () {
                DataFeedManager.configuration.popup.open(jQuery(this).val(), this);
            });


            /* ========= Preview + Library ================== */

            DataFeedManager.boxes.init();
            
            TablePreview = document.getElementById('preview-table-area');

            /* click on preview tag */
            jQuery(document).on('click', '.preview-tag.box-tag', function () {
                if (!jQuery(this).hasClass('selected') && jQuery(this).hasClass('opened')) { // panneau ouvert sur library
                    DataFeedManager.boxes.switchToPreview();
                } else if (jQuery(this).hasClass('selected') && jQuery(this).hasClass('opened')) { // panneau ouvert sur preview
                    DataFeedManager.boxes.close();
                } else { // panneau non ouvert
                    DataFeedManager.boxes.openPreview();
                }
            });

            /* click on library tag */
            jQuery(document).on('click', '.library-tag.box-tag', function () {
                if (!jQuery(this).hasClass('selected') && jQuery(this).hasClass('opened')) { // panneau ouvert sur preview
                    DataFeedManager.boxes.switchToLibrary();
                } else if (jQuery(this).hasClass('selected') && jQuery(this).hasClass('opened')) { // panneau ouvert sur library
                    DataFeedManager.boxes.close();
                } else { // panneau non ouvert
                    DataFeedManager.boxes.openLibrary();
                }
            });

            /* initialize the preview box with CodeMirror */
            CodeMirrorPreview = CodeMirror.fromTextArea(document.getElementById('preview-area'), {
                matchBrackets: true,
                mode: "application/x-httpd-php",
                indentUnit: 2,
                indentWithTabs: false,
                lineWrapping: false,
                lineNumbers: true,
                styleActiveLine: true,
                readOnly: true
            });

            /* click on refresh preview */
            jQuery(document).on('click', '.preview-refresh-btn', function () {
                DataFeedManager.boxes.switchToPreview();
                DataFeedManager.boxes.refreshPreview();
            });


            /* click on an attribute load sample */
            jQuery(document).on('click', '.load-attr-sample', function () {
                DataFeedManager.boxes.loadLibrarySamples(jQuery(this));
            });


            /* Click on one tag */
            jQuery(document).on("click", '.box-tag', function () {
                if (jQuery(this).hasClass("preview-tag") && !DataFeedManager.boxes.preview) {
                    DataFeedManager.boxes.preview = true;
                    DataFeedManager.boxes.refreshPreview();
                }
                if (jQuery(this).hasClass("library-tag") && !DataFeedManager.boxes.library) {
                    DataFeedManager.boxes.library = true;
                    DataFeedManager.boxes.loadLibrary();
                }
            });




            /* ========= Filters ========================= */

            /* select product types */
            jQuery(document).on("click", ".filter_product_type", function (evt) {
                var elt = jQuery(this);
                elt.parent().toggleClass('selected');
                DataFeedManager.filters.updateProductTypes();
            });
            DataFeedManager.filters.loadProductTypes();

            /* select attribute sets */
            jQuery(document).on("click", ".filter_attribute_set", function (evt) {
                var elt = jQuery(this);
                elt.parent().toggleClass('selected');
                DataFeedManager.filters.updateAttributeSets();
            });
            DataFeedManager.filters.loadAttributeSets();

            /* select product visibilities */
            jQuery(document).on("click", ".filter_visibility", function (evt) {
                var elt = jQuery(this);
                elt.parent().toggleClass('selected');
                DataFeedManager.filters.updateProductVisibilities();
            });

            DataFeedManager.filters.loadProductVisibilities();

            /* un/select all */
            jQuery(document).on("click", ".select-all", function (evt) {
                var elt = jQuery(this);
                DataFeedManager.filters.selectAll(elt);
            });
            jQuery(document).on("click", ".unselect-all", function (evt) {
                var elt = jQuery(this);
                DataFeedManager.filters.unselectAll(elt);
            });

            DataFeedManager.filters.updateUnSelectLinks();

            /* select advanced filters */

            // change attribute select 
            jQuery(document).on('change', '.name-attribute,.condition-attribute', function (evt) {
                var id = jQuery(this).attr('identifier');
                var attribute_code = jQuery('#name_attribute_' + id).val();
                DataFeedManager.filters.updateRow(id, attribute_code);

            });

            jQuery(document).on('change', '.checked-attribute,.statement-attribute,.name-attribute,.condition-attribute,.value-attribute,.pre-value-attribute', function (evt) {
                DataFeedManager.filters.updateAdvancedFilters();
            });



            DataFeedManager.filters.loadAdvancedFilters();


            /* ========= Categories ====================== */

            /* opening/closing treeview */
            jQuery(document).on("click", ".tv-switcher", function (evt) {
                var elt = jQuery(evt.target);
                // click on treeview expand/collapse
                if (elt.hasClass('closed')) {
                    elt.removeClass('closed');
                    elt.addClass('opened');
                    elt.parent().parent().find('> ul').each(function () {
                        jQuery(this).removeClass('closed');
                        jQuery(this).addClass('opened');
                    });
                } else if (elt.hasClass('opened')) {
                    elt.addClass('closed');
                    elt.removeClass('opened');
                    elt.parent().parent().find('> ul').each(function () {
                        jQuery(this).removeClass('opened');
                        jQuery(this).addClass('closed');
                    });
                }
            });

            // click on category select
            jQuery(document).on("click", ".category", function (evt) {
                jQuery(this).parent().toggleClass('selected');
                DataFeedManager.categories.selectChildren(jQuery(this));
                DataFeedManager.categories.updateSelection();
            });

            // change categories filter value
            jQuery(document).on("click", ".category_filter", function (evt) {
                jQuery("#category_filter").val(jQuery(this).val());
            });

            // change categories type value
            jQuery(document).on("click", ".category_type", function (evt) {
                jQuery("#category_type").val(jQuery(this).val());
            });

            /* change mapping */
            jQuery(document).on("change", ".mapping", function () {
                DataFeedManager.categories.updateSelection();
            });

            /* initialize dropdown mapping */
            DataFeedManager.categories.initAutoComplete();

            // change the taxonomy file 
            jQuery(document).on('change', '#feed_taxonomy', function () {
                DataFeedManager.categories.updateAutoComplete();
            });

            /* initialize end keyboard shortcut */
            jQuery(document).on("keyup", ".mapping", function (event) {
                if (event.key === "End") {
                    DataFeedManager.categories.updateChildrenMapping(jQuery(this));
                }
            });

            // load selected categories
            DataFeedManager.categories.loadCategories();
            // load the categories filter
            DataFeedManager.categories.loadCategoriesFilter();




            /* ========= Cron tasks  ================== */

            jQuery(document).on('change', '.cron-box', function () {
                jQuery(this).parent().toggleClass('selected');
                DataFeedManager.cron.updateExpr();
            });
            DataFeedManager.cron.loadExpr();

            CodeMirrorHeaderPattern.refresh();
            CodeMirrorProductPattern.refresh();
            CodeMirrorFooterPattern.refresh();

        });
    });
};