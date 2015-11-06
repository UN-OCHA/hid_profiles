var async = require('async'),
  _ = require('lodash'),
  log = require('../log'),
  config = require('../config'),
  mail = require('../mail'),
  List = require('../models').List,
  Contact = require('../models').Contact,
  Profile = require('../models').Profile;

// Middleware function to grant/deny access to the follow route.
function access(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all profiles.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      List.findById(req.params.id)
        .populate('readers')
        .populate('editors')
        .exec(function(err, list){
          if (!err) {
            Profile.findOne({userid: req.apiAuth.userId}, function (err, profile) {
              if (!err && profile && profile._id) {
                // Check list privacy settings
                if (list.privacy) {
                  var check = [], checkEditors = [];
                  if (list.privacy == 'some' && list.readers.length) {
                    check = list.readers.filter(function (obj) {
                      if (obj != null && obj.userid) {
                        return obj.userid === req.apiAuth.userId;
                      }
                    });
                  }

                  if (list.editors && list.editors.length) {
                    checkEditors = list.editors.filter(function (obj) {
                      if (obj != null && obj.userid) {
                        return obj.userid === req.apiAuth.userId;
                      }
                    });
                  }

                  if (req.apiAuth.userId != list.userid && !checkEditors.length && (list.privacy == 'me'
                    || (list.privacy == 'verified' && !profile.verified)
                    || (list.privacy == 'some' && !check.length))) {
                    res.send(403, new Error('Access Denied'));
                    return next(false);
                  }
                  else {
                    return next();
                  }
                }
                else {
                  return next();
                }
              }
              else {
                res.send(401, new Error('Could not find profile associated to user'));
                return next(false);
              }
            });
          }
          else {
            log.warn({'type': 'listFollowAccess:error', 'message': 'List not found', 'req': req});
            res.send(404, new Error('List not found'));
            return next(false);
          }
        });
    }
    else {
      res.send(401, new Error('No authorization credentials provided'));
      return next(false);
    }
  }
  else {
    log.warn({'type': 'listFollowAccess:error', 'message': 'No authorization credentials provided', 'req': req});
    res.send(401, new Error('No authorization credentials provided'));
    return next(false);
  }
}

// Follow a list
function follow(req, res, next) {
  List.findById(req.params.id, function (err, list) {
    if (err) {
      res.json({'status': 'error', 'message': 'Could not find list'});
      return next(false);
    }

    var index = list.users.indexOf(req.apiAuth.userId);
    if (index != -1) {
      res.json({'status': 'error', 'message': 'User is already following list'});
      return next(false);
    }
    else {
      list.users.push(req.apiAuth.userId);
      list.save(function (err) {
        if (err) {
          res.json({'status': 'error', 'message': 'Unknown error saving list'});
          return next(false);
        }
        res.json({'status': 'ok', 'message': 'User is now following the list'});
        return next();
      });
    }
  });
}

// Stop following a list
function unfollow(req, res, next) {
  List.findById(req.params.id, function (err, list) {
    if (err) {
      res.json({'status': 'error', 'message': 'Could not find list'});
      return next(false);
    }

    var index = list.users.indexOf(req.apiAuth.userId);
    if (index == -1) {
      res.json({'status': 'error', 'message': 'User is not following list'});
      return next(false);
    }
    else {
      list.users.splice(index, 1);
      list.save(function (err) {
        if (err) {
          res.json({'status': 'error', 'message': 'Unknown error saving list'});
          return next(false);
        }
        res.json({'status': 'ok', 'message': 'User is not following list anymore'});
        return next();
      });
    }
  });
}

exports.access = access;
exports.follow = follow;
exports.unfollow = unfollow;
