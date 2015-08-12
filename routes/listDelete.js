var async = require('async'),
  _ = require('lodash'),
  log = require('../log'),
  List = require('../models').List;

// Middleware function to grant/deny access to the listSave routes.
function postAccess(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all profiles.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      if (req.body._id) {
        //return res.send('test');
        List.findById(req.body._id, function(err, list){

          if (!err && list) {
            if (list.userid == req.apiAuth.userId) {
              return next();
            } else {
              return next(false);
            }
          } else {
            return next(false);
          }
        });
      }
      return;
    }
  }
  log.warn({'type': 'listDeleteAccess:error', 'message': 'Client not authorized to delete list', 'req': req});
  res.send(401, new Error('Client not authorized to delete list'));
  return next(false);
}

function post(req, res, next) {
  async.series([
    function(cb) {
      List.findByIdAndRemove(req.body._id, function(err, list){
        if (err) {
          return cb(err);
        }
      });

      cb();
    }
  ], function(err, list) {
    if (err) {
      return res.json({status: "error", message: "Could not delete contact list."});
    }
    return res.json({ status: 'ok', message: "List deleted"});
  });
}

exports.postAccess = postAccess;
exports.post = post;
