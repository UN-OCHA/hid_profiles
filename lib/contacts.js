var Contact = require('../models').Contact,
    mail = require('../mail'),
    intl = require('intl'),
    config = require('../config');

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
        checkoutDateFR: checkoutDate.toLocaleDateString('fr', dateOptions)
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
        remindedCheckoutDateFR: remindedCheckoutDate.toLocaleDateString('fr', dateOptions)
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
        var current = new Date();
        var dateOptions = { day: "numeric", month: "long", year: "numeric" };
        contact.hasLocalPhoneNumber(function (err, has) {

          var mailOptions = {
            to: contact.mainEmail(false),
            subject: 'Keeping your profile up to date',
            firstName: contact.nameGiven,
            contactURL: config.appBaseUrl + '#/profile/' + contact._id,
            contact: contact,
            hasLocalPhoneNumber: has,
          };

          // Send mail
          mail.sendTemplate('reminder_checkin', mailOptions, function (err, info) {
            if (!err) {
              console.log('INFO: sent reminder checkin email to ' + contact.mainEmail());
              // set remindedCheckin
              contact.remindedCheckin = current.valueOf();
              contact.save();
            }
          });
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
        subject: 'Keeping your profile up to date',
        firstName: contact.nameGiven,
        location: contact.location,
        contactURL: config.appBaseUrl + '#/profile/' + contact._id,
        profileType: contact.type
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


exports.sendReminderCheckoutEmails = sendReminderCheckoutEmails;
exports.doAutomatedCheckout = doAutomatedCheckout;
exports.sendReminderCheckinEmails = sendReminderCheckinEmails;
exports.sendReminderUpdateEmails = sendReminderUpdateEmails;
