var async = require('async'),
  _ = require('lodash'),
  mongoose = require('../models').mongoose,
  Profile = require('../models').Profile,
  Contact = require('../models').Contact,
  roles = require('../lib/roles.js'),
  log = require('../log'),
  config = require('../config'),
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
  var notifyEmail = req.body.notifyEmail || null;
  
  var result = {},
    profileExists = false,
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
    // Send email (if applicable)
    function (cb) {
      if (notifyEmail) {
        if (notifyEmail.type == 'notify_delete') {
          mailSubject = 'Humanitarian ID profile delete notification';
          mailWarning = {'type': 'notifyDeleteEmail:error', 'message': 'Profile Delete notification email sending failed to ' + notifyEmail.to + '.'};
          mailInfo = {'type': 'notifyCheckoutEmail:success', 'message': 'Profile Delete notification email sending successful to ' + notifyEmail.to + '.'};

          mailText = 'Dear ' + notifyEmail.recipientFirstName + ', \r\n\r\n' + notifyEmail.adminName + ' has deleted your profile (contact details) from Humanitarian ID. Such an action should only be taken at your request and with your consent.';
          mailText += '\r\n\r\nIf this action was taken in error, kindly contact '+ notifyEmail.adminName + ' or email info@humanitairan.id';
          mailText += '\r\n\r\nNote that your Humanitarian ID login credentials still remain valid. This arrangement means that you can continue to use them to log into a variety of websites or re-add your profile, with contact details, to Humanitarian ID.';
          mailText += '\r\n\r\nIf you believe that this email was sent incorrectly or inappropriately, please let us know at info@humanitarian.id.';
          mailText += '\r\n\r\nThe Humanitarian ID team';
          mailText += '\r\nSite: http://humanitarian.id';
          mailText += '\r\nAnimation: http://humanitarian.id/animation';
          mailText += '\r\nTwitter: https://twitter.com/humanitarianid';
          mailText += '\r\nYouTube: http://humanitarian.id/youtube';

          mailText += '\r\n\r\n—\r\n\r\n';

          mailText += 'Bonjour ' + notifyEmail.recipientFirstName + ', \r\n\r\n' + notifyEmail.adminName + ' a supprimé votre profile (coordonnées de contact) de Humanitarian ID. Normalement cela arrive seulement si vous avez faites la demande de supprimer votre profile.';
          mailText += '\r\n\r\nS’il s’agit d’une faute de notre part, on vous prie de bien vouloir contacter '+ notifyEmail.adminName + ' ou d’envoyer un courriel a email info@humanitairan.id';
          mailText += '\r\n\r\nVous pouvez continuer à utiliser votre Humanitarian ID login pour accéder d’autres sites web ou pour réinitialiser votre profile sur Humanitarian ID. ';
          mailText += '\r\n\r\nL’équipe Humanitarian ID';
          mailText += '\r\nSite: http://humanitarian.id';
          mailText += '\r\nAnimation: http://humanitarian.id/animation';
          mailText += '\r\nTwitter: https://twitter.com/humanitarianid';
          mailText += '\r\nYouTube: http://humanitarian.id/youtube';

          mailOptions = {
            from:  'Humanitarian ID<info@humanitarian.id>',
            to: notifyEmail.recipientEmail,
            subject: mailSubject,
            text: mailText
          };
          if (notifyEmail.adminEmail) {
            mailOptions.cc = !notifyEmail.adminName ? notifyEmail.adminEmail : notifyEmail.adminName + '<' + notifyEmail.adminEmail + '>';
          }

          // Send mail
          mail.sendMail(mailOptions, function (err, info) {
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
        }
        else{
          return cb();
        }
      }
      else{
        return cb();
      }
    },
  ], function (err, results) {
    res.send(result);
    next();
  });
}

exports.post = post;
exports.postAccess = postAccess;
