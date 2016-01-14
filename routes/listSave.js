var async = require('async'),
  _ = require('lodash'),
  log = require('../log'),
  mail = require('../mail'),
  List = require('../models').List,
  Contact = require('../models').Contact,
  Profile = require('../models').Profile;

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
                  if (value && value.userid && value.userid == req.apiAuth.userId) {
                    return value;
                  }
                });
              }
            
              if ((list.userid == req.apiAuth.userId || checkEditor.length)) {
                return next();
              } else {
                log.warn({'type': 'listSaveAccess:error', 'message': 'Client or user not authorized to save list', 'req': req});
                res.send(403, new Error('Client or user not authorized to save list'));
                return next(false);
              }
            } else {
              log.warn({'type': 'listSaveAccess:error', 'message': 'Could not find list', 'req': req});
              res.send(401, new Error('Could not find list'));
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
    log.warn({'type': 'listSaveAccess:error', 'message': 'Invalid authentication', 'req': req});
    res.send(401, new Error('Invalid authentication'));
    return next(false);
  }
}

// Make sure user has write access to a custom contact list
function writeAccess(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all profiles.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      if (req.params.list_id && req.params.contact_id) {
        List.findById(req.params.list_id)
          .populate('editors')
          .exec(function(err, list){
            if (!err) {
              var checkEditor = [];
              if (list.editors && list.editors.length) {
                checkEditor = list.editors.filter(function (value) {
                  if (value && value.userid && value.userid == req.apiAuth.userId) {
                    return value;
                  }
                });
              }

              if ((list.userid == req.apiAuth.userId || checkEditor.length)) {
                return next();
              } else {
                log.warn({'type': 'listSaveAccess:error', 'message': 'Client or user not authorized to save list', 'req': req});
                res.send(403, new Error('Client or user not authorized to save list'));
                return next(false);
              }
            } else {
              log.warn({'type': 'listSaveAccess:error', 'message': 'Could not find list', 'req': req});
              res.send(404, new Error('Could not find list'));
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
    log.warn({'type': 'listSaveAccess:error', 'message': 'Invalid authentication', 'req': req});
    res.send(401, new Error('Invalid authentication'));
    return next(false);
  }
}

// Add contact to a custom contact list
function addContact(req, res, next) {
  List.findById(req.params.id, function (err, list) {
    if (err) {
      res.json({'status': 'error', 'message': 'Could not find list'});
      return next(false);
    }

    var index = list.contacts.indexOf(req.body.contact);
    if (index != -1) {
      res.json({'status': 'error', 'message': 'Contact is already in list'});
      return next(false);
    }
    else {
      list.contacts.push(req.body.contact);
      list.save(function (err) {
        if (err) {
          res.json({'status': 'error', 'message': 'Unknown error saving list'});
          return next(false);
        }
        res.json({'status': 'ok', 'message': 'Contact added successfully'});
        return next();
      });
    }
  });
}

// Delete contact from a list
function deleteContact(req, res, next) {
  List.findById(req.params.list_id, function (err, list) {
    if (err) {
      res.json({'status': 'error', 'message': 'Could not find list'});
      return next(false);
    }

    var index = list.contacts.indexOf(req.params.contact_id);
    if (index == -1) {
      res.json({'status': 'error', 'message': 'Contact is not in list'});
      return next(false);
    }
    else {
      list.contacts.splice(index, 1);
      list.save(function (err) {
        if (err) {
          res.json({'status': 'error', 'message': 'Unknown error saving list'});
          return next(false);
        }
        res.json({'status': 'ok', 'message': 'Contact removed successfully'});
        return next();
      });
    }
  });
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

      if (req.body.privacy) {
        updatedList.privacy = req.body.privacy;
      }

      if (req.body.readers) {
        if (req.body.readers.length && req.body.readers.indexOf(null) != -1) {
          // Make sure none of the readers is set to null
          return cb('Could not save contact list because one of the readers is set to null');
        }
        updatedList.readers = req.body.readers;
      }

      if (req.body.editors) {
        if (req.body.editors.length && req.body.editors.indexOf(null) != -1) {
          return cb('Could not save contact list because one of the editors is set to null');
        }
        updatedList.editors = req.body.editors;
      }

      if (req.body.userid && req.body.userid != origList.userid && req.apiAuth.userId === origList.userid) {
        updatedList.userid = req.body.userid;
        // Make sure original owner is added as an editor and follower
        Profile.findOne({'userid': origList.userid}, function (err, profile) {
          if (err) {
            return cb(err);
          }
          if (!profile) {
            return cb('Wrong userid: profile could not be found');
          }
          if (!updatedList.editors.length) {
            updatedList.editors = [];
          }
          if (updatedList.editors.indexOf(profile._id) === -1) {
            updatedList.editors.push(profile._id);
          }
          if (!updatedList.users.length) {
            updatedList.users = [];
          }
          if (updatedList.users.indexOf(origList.userid) === -1) {
            updatedList.users.push(origList.userid);
          }
          return cb();
        });
      }
      else {
        return cb();
      }
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
      // Get new readers
      var usersAdded = [], editorsAdded = [];
      updatedList.editors.forEach(function (value, i) {
        if (value != null && origList.editors.indexOf(value.toString()) == -1) {
          editorsAdded.push(value);
        }
      });
      if (updatedList.privacy == 'some') {
        updatedList.readers.forEach(function(value, i) {
          if (value != null && origList.readers.indexOf(value.toString()) == -1 && editorsAdded.indexOf(value) == -1) {
            usersAdded.push(value);
          }
        });
      }
      if (usersAdded.length || editorsAdded.length) {
        var emailCallback = function (value, i) {
          var action = this.action;
          // Get global contact from profile
          Contact.findOne({'_profile': value, 'type': 'global'})
          .populate('_profile')
          .exec(function (err, contact) {
            if (err) {
              return;
            }
            if (contact._profile && contact._profile.userid && updatedList.users && updatedList.users.indexOf(contact._profile.userid) == -1) {
              updatedList.users.push(contact._profile.userid);
              updatedList.save();
            }
            var mailOptions = {
              to: contact.mainEmail(false),
              subject: 'You were given the ability to ' + action.EN + ' ' + updatedList.name + ' on Humanitarian ID',
              list: updatedList,
              listUrl: process.env.APP_BASE_URL + '#/list/contacts?id=' + updatedList._id,
              firstName: contact.nameGiven,
              action: action
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
        };
        var action = {
          action: {
            EN: 'view',
            FR: 'voir'
          }
        };
        if (updatedList.privacy == 'some') {
          usersAdded.forEach(emailCallback, action);
        }
        action.action.EN = 'edit';
        action.action.FR = 'éditer';
        editorsAdded.forEach(emailCallback, action);
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
exports.writeAccess = writeAccess;
exports.addContact = addContact;
exports.deleteContact = deleteContact;
