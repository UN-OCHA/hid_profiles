var async = require('async'),
  _ = require('lodash'),
  log = require('../log'),
  config = require('../config'),
  mail = require('../mail'),
  List = require('../models').List,
  Contact = require('../models').Contact;

// Middleware function to grant/deny access to the listSave routes.
function postAccess(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all profiles.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      if (req.body._id) {
        List.findById(req.body._id)
          .populate('editors')
          .exec(function(err, list){
            if (!err) {
              if (list) {
                req.apiAuth.customList = list;
              }

              // Check to see if we are following or unfollowing. If we are then strip
              // everything from the request except users.
              var diff = _.difference(list.users, req.body.users);
              var diff2 = _.difference(req.body.users, list.users);
              if (diff.length > 0 || diff2.length > 0) {
                delete req.body.name;
                delete req.body.contacts;
                delete req.body.readers;
                delete req.body.privacy;
                delete req.body.editors;
                return next();
              }

              var checkEditor = [];
              if (list.editors && list.editors.length) {
                checkEditor = list.editors.filter(function (value) {
                  if (value.userid == req.apiAuth.userId) {
                    return value;
                  }
                });
              }
            
              if ((list.userid == req.apiAuth.userId || checkEditor.length)) {
                return next();
              } else {
                log.warn({'type': 'listSaveAccess:error', 'message': 'Client or user not authorized to save list', 'req': req});
                res.send(401, new Error('Client or user not authorized to save list'));
                return next(false);
              }
            } else {
              log.warn({'type': 'listSaveAccess:error', 'message': 'Client or user not authorized to save list', 'req': req});
              res.send(401, new Error('Client or user not authorized to save list'));
              return next(false);
            }
          });
      }
      else {
        return next();
      }
    }
  }
  else {
    log.warn({'type': 'listSaveAccess:error', 'message': 'Client or user not authorized to save list', 'req': req});
    res.send(401, new Error('Client or user not authorized to save list'));
    return next(false);
  }
}

function post(req, res, next) {
  var origList = {}, updatedList = {};

  async.series([
    function(cb) {
      // TODO: Replace this with req.apiAuth.customList = list;
      if (req.body._id) {
        List.findById(req.body._id, function(err, list){
          if (err) {
            return cb(err);
          }

          updatedList = list;
          // Clone list into origList
          origList = JSON.parse(JSON.stringify(list));

          cb();
        });
      } else {
        updatedList = new List({
          userid: req.apiAuth.userId,
          users: [req.apiAuth.userId],
          privacy: 'all'
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

      if (req.body.privacy && (req.body.privacy == 'me' || req.body.privacy == 'all' || req.body.privacy == 'verified' || req.body.privacy == 'some')) {
        updatedList.privacy = req.body.privacy;
      }

      if (req.body.readers) {
        updatedList.readers = req.body.readers;
      }

      if (req.body.editors) {
        updatedList.editors = req.body.editors;
      }

      cb();
    },
    function(cb) {
      updatedList.save(function(err, list){
        if (err) {
          return cb(err);
        }
        cb();
      });

    },
    function (cb) {
      var usersAdded = [];
      if (updatedList.privacy == 'some') {
        // Get new readers
        var usersAdded = [];
        updatedList.readers.forEach(function(value, i) {
          if (value != null && origList.readers.indexOf(value.toString()) == -1) {
            usersAdded.push(value);
          }
        });
        if (usersAdded.length) {
          usersAdded.forEach(function (value) {
            // Get global contact from profile
            Contact.findOne({'_profile': value, 'type': 'global'}, function (err, contact) {
              if (err) {
                return;
              }
              var mailOptions = {
                to: contact.mainEmail(false),
                subject: 'You were given the ability to view ' + updatedList.name + ' on Humanitarian ID',
                list: updatedList,
                listUrl: config.appBaseUrl + '#/list/contacts?id=' + updatedList._id,
                firstName: contact.nameGiven
              };

              // Send mail
              mail.sendTemplate('notify_custom_list', mailOptions, function (err, info) {
                if (err) {
                  log.warn({'type': 'listSave:error', 'message': 'listSave: Error sending email to ' + mailOptions.to + '.'});
                }
                else {
                  log.info({'type': 'listSave:success', 'message': 'Notify custom contact list email sending successful to ' + mailOptions.to + '.'});
                }
              });
            });
          });
        }
      }
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
