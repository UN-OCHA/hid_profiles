var Contact = require('../models').Contact,
    Profile = require('../models').Profile,
    mail = require('../mail'),
    intl = require('intl'),
    async = require('async');

function sendReminderCheckoutEmails(cb) {
  console.log('INFO: sending reminder checkout emails to contacts');
  var stream = Contact.find({'type': 'local', $or: [{ 'remindedCheckout': null}, {'remindedCheckout': false}], 'status': true }).stream();

  stream.on('data', function(contact) {
    if (contact.shouldSendReminderCheckout()) {
      var current = new Date();
      var depDate = new Date(contact.departureDate);
      var checkoutDate = new Date(current.valueOf() + (12 * 24 * 3600 * 1000));
      var dateOptions = { day: "numeric", month: "long", year: "numeric" };
      var mailOptions = {
        to: contact.mainEmail(false),
        subject: 'Check-out reminder',
        firstName: contact.nameGiven,
        location: contact.location,
        departureDate: depDate.toLocaleDateString('en', dateOptions),
        checkoutDate: checkoutDate.toLocaleDateString('en', dateOptions),
        departureDateFR: depDate.toLocaleDateString('fr', dateOptions),
        checkoutDateFR: checkoutDate.toLocaleDateString('fr', dateOptions),
        checkoutPath: process.env.APP_BASE_URL + '/#/contact/' + contact._id + '/checkout'
      };

      // Send mail
      mail.sendTemplate('reminder_checkout', mailOptions, function (err, info) {
        if (!err) {
          console.log('INFO: sent reminder checkout email to ' + contact.mainEmail());
          // set remindedCheckout to true
          contact.remindedCheckout = true;
          contact.remindedCheckoutDate = current.toISOString();
          contact.save();
        }
      });
    }
  });
  
  stream.on('close', function () {
    cb();
  });
}

function doAutomatedCheckout(cb) {
  console.log('INFO: running automated checkouts');
  var stream = Contact.find({ 'type': 'local', 'status': true, 'remindedCheckout': true}).stream();

  stream.on('data', function (contact) {
    if (contact.shouldDoAutomatedCheckout()) {
      var remindedCheckoutDate = new Date(contact.remindedCheckoutDate);
      var dateOptions = { day: "numeric", month: "long", year: "numeric" };
      var mailOptions = {
        to: contact.mainEmail(false),
        subject: 'Automated checkout',
        firstName: contact.nameGiven,
        location: contact.location,
        remindedCheckoutDate: remindedCheckoutDate.toLocaleDateString('en', dateOptions),
        remindedCheckoutDateFR: remindedCheckoutDate.toLocaleDateString('fr', dateOptions),
        checkinLink: process.env.APP_BASE_URL + '/#/contact/' + contact._id + '/checkin'
      };
      contact.checkout(function(err) {
        if (!err) {    
          mail.sendTemplate('automated_checkout', mailOptions, function (err, info) {
            if (!err) {
              console.log('INFO: sent automated checkout email to ' + contact.mainEmail());
            }
          });
        }
      });
    }
  });

  stream.on('close', function () {
    cb();
  });
}

// Reminder emails sent out 48 hours after checkin to remind people to add a local phone number if they didn't do so
function sendReminderCheckinEmails(cb) {
  console.log('INFO: sending reminder checkin emails to contacts');
  var stream = Contact.find({'type': 'local', 'remindedCheckin': null, 'status': true }).stream();

  stream.on('data', function(contact) {
    contact.shouldSendReminderCheckin(function (err, send) {
      if (!err && send) {
        contact.hasLocalPhoneNumber(function (err, has) {
          if (contact.mainEmail(false)) {
            var mailOptions = {
              to: contact.mainEmail(false),
              subject: 'Keeping your ' + contact.location + ' profile up to date',
              contact: contact,
              hasLocalPhoneNumber: has,
              firstName: contact.nameGiven,
              contactURL: process.env.APP_BASE_URL + '/#/profile/' + contact._id     
            };

            // Send mail
            mail.sendTemplate('reminder_checkin', mailOptions, function (err, info) {
              if (err) {
                console.log(err);
              }
              else {
                var current = new Date();
                console.log('INFO: sent reminder checkin email to ' + contact.mainEmail());
                // set remindedCheckin
                contact.remindedCheckin = current.valueOf();
                contact.save();
              }
            });
          }
        });
      }
    });
  });

  stream.on('close', function () {
    cb();
  });
}

// Reminder email sent out every 6 months to people who haven't updated their profile during the last 6 months (183 days)
function sendReminderUpdateEmails(cb) {
  console.log('INFO: sending reminder update emails to contacts');
  var d = new Date();
  var sixm_ago = d.valueOf() - 183 * 24 * 3600 * 1000;
  var stream = Contact.find({
    'status': true,
    'type': 'local',
    $or: [{ $and: [{ 'revised': null}, {'created': { $lt: sixm_ago }}]}, {'revised': { $lt: sixm_ago }}]
  }).stream();

  stream.on('data', function(contact) {
    if (contact.shouldSendReminderUpdate()) {
      var current = new Date();
      var dateOptions = { day: "numeric", month: "long", year: "numeric" };
      var mailOptions = {
        to: contact.mainEmail(false),
        subject: 'Keeping your ' + contact.location + ' profile up to date',
        firstName: contact.nameGiven,
        contactURL: process.env.APP_BASE_URL + '/#/profile/' + contact._id,
        contact: contact
      };

      // Send mail
      mail.sendTemplate('reminder_update', mailOptions, function (err, info) {
        if (!err) {
          console.log('INFO: sent reminder update email to ' + contact.mainEmail());
          // set remindedUpdate date
          contact.remindedUpdate = d.valueOf();
          contact.save();
        }
      });
    }
  });

  stream.on('close', function () {
    cb();
  });
}

// Remove duplicate global profiles
function removeDuplicateProfiles(cb) {
  console.log('INFO: removing duplicate global profiles');
  var stream = Profile.find().stream();

  stream.on('data', function (profile) {
    this.pause();
    var self = this;
    Contact.find({'_profile': profile._id, 'type': 'global'}, function (err, contacts) {
      if (err) {
        console.log('Error finding duplicate profiles');
        self.resume();
      }
      if (contacts.length > 1) {
        // Sort by last updated
        contacts = contacts.sort(function (a, b) {
          var arevised = a.revised || 0;
          var brevised = b.revised || 0;
          var astatus = a.status, bstatus = b.status;
          if (astatus == bstatus) {
            if (arevised > brevised) {
              return -1;
            }
            if (arevised < brevised) {
              return 1;
            }
            return 0;
          }
          else {
            if (astatus == true) {
              return -1;
            }
            if (bstatus == true) {
              return 1;
            }
          }
        });
        contacts.shift();
        async.each(contacts, function (contact, cb) {
          console.log('Removing contact ' + contact._id + ' from profile ' + contact.nameGiven + ' ' + contact.nameFamily + ' with status ' + contact.status);
          Contact.findByIdAndRemove(contact._id, function (err) {
            if (err) {
              console.log('Error removing contact ' + contact._id);
              cb(err);
            }
            else {
              cb();
            }
          });
        }, function (err) {
          self.resume();
        });
      }
      else {
        self.resume();
      }
    });
  });

  stream.on('close', function () {
    cb();
  });
}

exports.sendReminderCheckoutEmails = sendReminderCheckoutEmails;
exports.doAutomatedCheckout = doAutomatedCheckout;
exports.sendReminderCheckinEmails = sendReminderCheckinEmails;
exports.sendReminderUpdateEmails = sendReminderUpdateEmails;
exports.removeDuplicateProfiles = removeDuplicateProfiles;
