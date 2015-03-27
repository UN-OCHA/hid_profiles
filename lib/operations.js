var async = require('async'),
  _ = require('lodash'),
  log = require('../log'),
  restify = require('restify'),
  config = require('../config');

function getOperations(req, res, next) { 
  var result = {};
  
  async.series([
    function (cb) {
      var request;

      var client = restify.createJsonClient({
        url: config.hrinfoBaseUrl,
        version: '*'
      });

      client.get("/api/v1.0/operations", function(err, req, res, obj) {
        if (obj && obj.data) {
          var data = obj.data;   
          result = {status: "ok", data: data};
          return cb();
        }
        else {
          result = {status: "error", message: "Could not get operations."};
          return cb(true);
        }
      });
    }
  ], function (err, results) {
        res.send(result);
        next();
  });
}


exports.getAll = getOperations;
//exports.get = getOperation;

