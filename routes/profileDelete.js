var async = require('async'),
  _ = require('lodash'),
  mongoose = require('../models').mongoose,
  Profile = require('../models').Profile,
  Contact = require('../models').Contact,
  roles = require('../lib/roles.js'),
  log = require('../log'),
  restify = require('restify'),
  middleware = require('../middleware');
  mail = require('../mail');

// Middleware function to grant/deny access to the protected routes
function postAccess(req, res, next) {
  if (req.apiAuth && req.apiAuth.mode) {
    // Trusted API clients are allowed write access to all contacts.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      return next();
    }
    // Verify administrative role to ensure only admins can delete profiles
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      Profile.findOne({userid: req.apiAuth.userId}, function (err, userProfile) {
        if (!err) {
          if (userProfile) {
            req.apiAuth.userProfile = userProfile;
          }

          if (userProfile.roles && userProfile.roles.length && roles.has(userProfile, /^admin$/)) {
            return next();
          }
        }
        log.warn({'type': 'profileDelete:error', 'message': 'User ' + req.apiAuth.userId + ' is not authorized to delete profile for ' + req.body.userid, 'req': req});
        res.send(403, new Error('User not authorized to save contact'));
        return next(false);
      });
      return;
    }
  }
  log.warn({'type': 'profileDeleteAccess:error', 'message': 'Client not authorized to delete profile', 'req': req});
  res.send(403, new Error('Client not authorized to delete profile'));
  return next(false);
}

function post(req, res, next) {
  var userid = req.body.userId || null;
  var adminName = req.body.adminName || null;
  
  var result = {},
    profileExists = false,
    adminContact = null,
    globalContact = null,
    _profile = null;

  async.series([
    //Check to see if profile exists 
    function (cb) {
      if (!userid || !userid.length) {
        result = {status: "error", message: "No Profile ID was specified."};
        log.warn({'type': 'profileDelete:error', 'message': 'profileDelete: invalid request: No Profile ID was specified.', 'req': req});
        return cb(true);
      }
      else {
        Profile.findOne({userid: userid}, function (err, profile) {
          if (err || !profile || !profile._id) {
            log.warn({'type': 'post:error', 'message': 'Error occurred or could not find profile for user ' + userid, 'err': err});
            result = {status: "error", message: "Could not find existing profile."};
            result.profileExists = false;
            return cb(true);
          }
          else {
            _profile = profile._id;
            return cb();
          }
        });
      }
    },
    // Set status for profile to 0
    function (cb) {
      Profile.update({userid: userid}, {status: 0}, {multi: true}, function(err, profile) {
        if (err) {
          log.warn({'type': 'post:error', 'message': 'Error occurred while trying to delete profile for user ID ' + userid, 'err': err});
          result = {status: "error", message: "Could not delete profile for user."};
          return cb(true);
        }
        else{
          return cb();
        }
      });
    },
    // Set status for contacts to 0
    function (cb) {
      Contact.update({_profile: _profile}, {status: 0}, {multi: true}, function(err, profile) {
        if (err) {
          log.warn({'type': 'post:error', 'message': 'Error occurred while trying to delete profile for user ID ' + userid, 'err': err});
          result = {status: "error", message: "Could not delete profile for user."};
          return cb(true);
        }
        else{
          result = {status: "ok", "_id": _profile};
          return cb();
        }
      });
    },
    // Find admin profile
    function (cb) {
      Contact.findOne({'_profile': req.apiAuth.userProfile._id, 'type': 'global'}, function (err, doc) {
        if (!err && doc && doc._id) {
          adminContact = doc;
        }
        return cb();
      });
    },
    // Find global contact for profile being deleted
    function (cb) {
      Contact.findOne({'_profile': _profile, 'type': 'global'}, function (err, doc) {
        if (!err && doc && doc._id) {
          globalContact = doc;
        }
        return cb();
      });
    },
    // Send email (if applicable)
    function (cb) {
      mailSubject = 'Humanitarian ID profile delete notification';
      mailWarning = {'type': 'notifyDeleteEmail:error', 'message': 'Profile Delete notification email sending failed to ' + globalContact.mainEmail() + '.'};
      mailInfo = {'type': 'notifyCheckoutEmail:success', 'message': 'Profile Delete notification email sending successful to ' + globalContact.mainEmail() + '.'};

      mailOptions = {
        to: globalContact.mainEmail(),
        cc: adminContact.mainEmail(false),
        subject: mailSubject,
        recipientFirstName: globalContact.nameGiven,
        adminName: adminContact.fullName()
      };

      // Send mail
      mail.sendTemplate('notify_delete', mailOptions, function (err, info) {
        if (err) {
          mailWarning.err = err;
          log.warn(mailWarning);
          return cb(true);
        }
        else {
          log.info(mailInfo);
          options = {};
          return cb();
        }
      });
    },
  ], function (err, results) {
    res.send(result);
    next();
  });
}

exports.post = post;
exports.postAccess = postAccess;
