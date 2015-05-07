var _ = require('lodash'),
    log = require('../log'),
    Profile = require('../models').Profile;

// Middleware function to grant/deny access to the profileSave routes.
function postAccess(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all profiles.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    // Users are allowed write access only to their own profiles, unless they
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      Profile.findOne({userid: req.apiAuth.userId}, function (err, userProfile) {
        if (!err) {
          if (userProfile) {
            req.apiAuth.userProfile = userProfile;
          }
          if (req.apiAuth.userId === req.body.userid) {
            return next();
          }
        }
        log.warn({'type': 'profileSaveAccess:error', 'message': 'User ' + req.apiAuth.userId + ' is not authorized to save profile for ' + req.body.userid, 'req': req});
        res.send(401, new Error('User not authorized to save profile'));
        return next(false);
      });
      return;
    }
  }
  log.warn({'type': 'profileSaveAccess:error', 'message': 'Client not authorized to save profile', 'req': req});
  res.send(401, new Error('Client not authorized to save profile'));
  return next(false);
}

function post(req, res, next) {

  if (req.query.field === 'customContact' && req.query.name) {
    var updateData,
        listIndex = -1,
        contactIndex = -1,
        contactLists = req.apiAuth.userProfile.contactLists || [];

    // Find index of contact list and contact if they exist.
    _.forEach(contactLists, function(list, key){
      if (list.name === req.query.name) {
        listIndex = key;
        if (req.query.contactId) {
          contactIndex = list.contacts.indexOf(req.query.contactId);
        }
      }
    });
    // Check if you intend to add or remove contact.
    if (req.query.action === 'remove') {
      // Remove contact if found, otherwise do nothing.
      if (listIndex !== -1 && contactIndex !== -1) {
        contactLists[listIndex].contacts.splice(contactIndex, 1);
        updateData = {"contactLists": contactLists};
      }
    }
    // If no action present presume you intend to add contact.
    else {
      // If add new list if none by requested name exist.
      if (listIndex === -1 && req.query.contactId) {
        contactLists.push({
          name: req.query.name,
          contacts : [req.query.contactId]
        });
        updateData = {"contactLists": contactLists};
      }
      // If list exist, only add contact if not already added.
      else if (listIndex !== -1 && contactIndex === -1 && req.query.contactId) {
        contactLists[listIndex].contacts.push(req.query.contactId);
        updateData = {"contactLists": contactLists};
      }
    }
    // Only update if change has been made.
    if (updateData) {
      Profile.update({ userid: req.body.userid }, {$set:updateData}, function(err) {
        if (!err) {
          res.send(updateData);
          console.dir(updateData);
          next();
        }
        else {
          log.warn({'type': 'post:error', 'message': 'Error occurred while trying to update/insert profile for user ID ' + req.body.userid, 'err': err});
          res.send(400, new Error('Error occurred attempt to save profile'));
          next(false);
        }
      });
    }
    else {
      next();
    }
  }
  else {
    log.warn({'type': 'profileSaveAccess:error', 'message': 'Invaild attempt to save profile for ' + req.body.userid, 'req': req});
    res.send(403, new Error('Invaild attempt to save profile'));
    next(false);
  }
}

exports.postAccess = postAccess;
exports.post = post;
