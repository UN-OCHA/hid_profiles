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
        List.findById(req.body._id, function(err, list){
          if (!err) {
            if (list) {
              req.apiAuth.customList = list;
            }

            if (list.userid == req.apiAuth.userId) {
              return next();
            } else {

              // Check to see if we are unfollowing. If we are then strip
              // everything from the request except users.
              var diff = _.difference(list.users, req.body.users);
              if (diff.length == 1 && diff[0] == req.apiAuth.userId) {
                delete req.body.name;
                delete req.body.contacts;
                return next();
              }
              return next(false);
            }
          } else {
            return next(false);
          }
        });
      }
      return next();
    }
  }
  log.warn({'type': 'listSaveAccess:error', 'message': 'Client not authorized to save list', 'req': req});
  res.send(401, new Error('Client not authorized to save list'));
  return next(false);
}

function post(req, res, next) {
  var updatedList = {};

  async.series([
    function(cb) {
      // TODO: Replace this with req.apiAuth.customList = list;
      if (req.body._id) {
        List.findById(req.body._id, function(err, list){
          if (err) {
            return cb(err);
          }

          updatedList = list;

          cb();
        });
      } else {
        updatedList = new List({
          userid: req.apiAuth.userId,
          users: [req.apiAuth.userId],
          privacy: 'me'
        });

        cb();
      }
    },
    function(cb) {
      if (req.body.name) {
        updatedList.name = req.body.name;
      }

      if (req.body.contacts) {
        updatedList.contacts = req.body.contacts;
      }

      if (req.body._id && req.body.users) {
        updatedList.users = req.body.users;
      }

      if (req.body.privacy) {
        updatedList.privacy = req.body.privacy;
      }

      cb();
    },
    function(cb) {
      updatedList.save(function(err, list){
        if (err) {
          return cb(err);
        }
      });

      cb();
    }
  ], function(err, list) {
    if (err) {
      return res.json({status: "error", message: "Could not save contact list."});
    }
    res.json({ status: 'ok', message: "List saved", list: updatedList});
  });
}

exports.postAccess = postAccess;
exports.post = post;
