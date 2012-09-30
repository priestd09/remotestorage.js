define([
  'require',
  './lib/widget',
  './lib/baseClient',
  './lib/store',
  './lib/sync',
  './lib/wireClient',
  './lib/nodeConnect',
  './lib/util'
], function(require, widget, baseClient, store, sync, wireClient, nodeConnect, util) {

  "use strict";

  var claimedModules = {}, modules = {};

  var logger = util.getLogger('base');

  function deprecate(oldFn, newFn) {
    logger.error("DEPRECATION: " + oldFn + " is deprecated! Use " + newFn + " instead.");
  }

  /**
     @module remoteStorage
  */
  var remoteStorage =  { 

    /**
     ** PUBLIC METHODS
     **/

    /**
       @method defineModule
       @memberof module:remoteStorage
       
       @desc Define a new module, with given name.
       Module names MUST be unique. The given builder will be called
       immediately, with two arguments, which are both instances of
       baseClient. The first accesses the private section of a modules
       storage space, the second the public one. The public area can
       be read by any client (not just an authenticated one), while
       it can only be written by an authenticated client with read-write
       access claimed on it.
       
       The builder is expected to return an object, as described under
       remoteStorage.getModuleInfo.

       @param {String} moduleName Name of the module to define. SHOULD be a-z and all lowercase.
       @param {Function} builder Builder function that holds the module definition.
       @see remoteStorage.getModuleInfo
     */
    defineModule: function(moduleName, builder) {
      logger.debug('DEFINE MODULE', moduleName);
      var module = builder(
        // private client:
        baseClient.getInstance(moduleName, false),
        // public client:
        baseClient.getInstance(moduleName, true)
      );
      modules[moduleName] = module;
      this[moduleName] = module.exports;
      logger.debug('Module defined: ' + moduleName, module, this);
    },

    /**
       @method getModuleList
       @memberof module:remoteStorage

       @desc Get an Array of all moduleNames, currently defined.
     */
    getModuleList: function() {
      return Object.keys(modules);
    },

    /**
       @method getClaimedModuleList
       @memberof module:remoteStorage

       @desc Get a list of all modules, currently claimed access on.
    */
    getClaimedModuleList: function() {
      return Object.keys(claimedModules);
    },

    /**
       @method getModuleInfo
       @memberof module:remoteStorage
       @summary Retrieve meta-information about a given module.
     
       @desc If the module doesn't exist, the result will be undefined.
     
       Module information currently gives you the following (if you're lucky):
      
       * exports - don't ever use this. it's basically the module's instance.
       * name - the name of the module, but you knew that already.
       * dataHints - an object, describing internas about the module.
      
       Some of the dataHints used are:
      
         objectType <type> - description of an object
                             type implemented by the module:
           "objectType message"
      
         <attributeType> <objectType>#<attribute> - description of an attribute
      
           "string message#subject"
      
         directory <path> - description of a path's purpose
      
           "directory documents/notes/"
      
         item <path> - description of a special item
      
           "item documents/notes/calendar"
      
       Hope this helps.
  
       @param {String} moduleName Name of the module to get information about.
     */
    getModuleInfo: function(moduleName) {
      return modules[moduleName];
    },

    /**
       @method claimAccess
       @memberof module:remoteStorage
       @summary Claim access for a set of modules.
       @desc
       You need to claim access to a module before you can
       access data from it.
      
       Modules can be specified in two ways:
      
       * via a string plus access mode for single modules:
      
         remoteStorage.claimAccess('contacts', 'r');
      
       * via an object for multiple modules:
      
         remoteStorage.claimAccess({
           contacts: 'r',
           documents: 'rw',
           money: 'r'
         });
      
       Access mode can be 'r' for read-only or 'rw' for read-write.
      
       Errors:
      
       claimAccess() will throw an exception, if any given module hasn't been
       defined (yet). Access to all previously processed modules will have been
       claimed, however.

       @param {Object|String} moduleName See description for details.
       @param {String} [mode] See description for details.
     */
    claimAccess: function(moduleName, mode) {
      
      var modeTestRegex = /^rw?$/;
      function testMode(moduleName, mode) {
        if(!modeTestRegex.test(mode)) {
          throw "Claimed access to module '" + moduleName + "' but mode not correctly specified ('" + mode + "').";
        }
      }
      
      var moduleObj;
      if(typeof moduleName === 'object') {
        moduleObj = moduleName;
      } else {
        testMode(moduleName, mode);
        moduleObj = {};
        moduleObj[moduleName] = mode
      }
      for(var _moduleName in moduleObj) {
        var _mode = moduleObj[_moduleName];
        testMode(_moduleName, _mode);
        this.claimModuleAccess(_moduleName, _mode);
      }
    },

    /** @private */
    claimModuleAccess: function(moduleName, mode) {
      logger.debug('claimModuleAccess', moduleName, mode);
      if(!(moduleName in modules)) {
        throw "Module not defined: " + moduleName;
      }

      if(moduleName in claimedModules) {
        return;
      }

      if(moduleName == 'root') {
        moduleName = '';
        widget.addScope('', mode);
        baseClient.claimAccess('/', mode);
      } else {
        widget.addScope(moduleName, mode);
        baseClient.claimAccess('/'+moduleName+'/', mode);
        baseClient.claimAccess('/public/'+moduleName+'/', mode);
      }
      claimedModules[moduleName] = true;
    },

    /** @private */
    setBearerToken: function(bearerToken, claimedScopes) {
      wireClient.setBearerToken(bearerToken);
      baseClient.claimScopes(claimedScopes);
    },

    /**
     ** DELEGATED METHODS
     **/

    disconnectRemote : wireClient.disconnectRemote,

    /**
       @method flushLocal
       @memberof module:remoteStorage

       @summary Forget this ever happened.

       @desc Delete all locally stored data.
       This doesn't clear localStorage, just removes everything
       remoteStorage.js ever saved there (though obviously only under
       the current origin).
       
       To implement logging out, use (at least) this.
    */
    flushLocal       : store.forgetAll,

    /**
       @method syncNow
       @memberof module:remoteStorage

       @summary Synchronize local <-> remote storage.

       @desc Syncing starts at given path and bubbles down.
       The actual changes to either local or remote storage happen in the
       future, so you should attach change handlers on the modules you're
       interested in.
       
       Example:
         remoteStorage.money.on('change', function(changeEvent) {
           updateBudget(changeEvent);
         });
         remoteStorage.syncNow('/money');
     
       Modules may bring their own sync method, which should take preference
       over the one here.
     
     */
    syncNow          : sync.syncNow,

    // documented in widget.
    displayWidget    : widget.display,

    getWidgetState   : widget.getState,
    setStorageInfo   : wireClient.setStorageInfo,
    getStorageHref   : wireClient.getStorageHref,

    nodeConnect: nodeConnect,

    util: util

  };

  return remoteStorage;
});
