var async = require('async');
var roles = require('../lib/roles.js');
var protectedRoles = require('../lib/protectedRoles.js');
var log = require('../log');

function getAppData(req, res, next) {
  var appData = {};
  async.series([
    function (cb) {
      roles.get(function (err, data) {
        appData.roles = data;
        return cb();
      });
    },
    function (cb) {
      protectedRoles.get(function (err, data) {
        appData.protectedRoles = data;
        return cb();
      });
    }
  ], function(err, results) {
    res.send(appData);
    log.info({'type': 'getAppData:success', 'message': 'Successfully returned app data'});
  });
}

exports.get = getAppData;
