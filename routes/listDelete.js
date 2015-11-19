var async = require('async'),
  _ = require('lodash'),
  log = require('../log'),
  List = require('../models').List;

// Middleware function to grant/deny access to the listSave routes.

function deleteAccess(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all profiles.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      if (req.params.id) {
        List.findById(req.params.id, function(err, list){
          if (!err && list) {
            if (list.userid == req.apiAuth.userId) {
              return next();
            } else {
              res.send(403, new Error('Client not authorized to delete list'));
              return next(false);
            }
          } else {
            res.send(404, new Error('List' + req.params.id + ' not found'));
            return next(false);
          }
        });
      }
      return;
    }
  }
  res.send(401, new Error('No authentication provided'));
  return next(false);
}

function del(req, res, next) {
  List.findByIdAndRemove(req.params.id, function (err, list) {
    if (err) {
      res.send(500, new Error(err));
      return next(err);
    }
    if (!list) {
      res.send(404, new Error('List ' + req.params.id + ' not found'));
    }
    else {
      res.send(204);
    }
    next();
  });
}

exports.deleteAccess = deleteAccess;
exports.del = del;
