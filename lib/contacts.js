var Contact = require('../models').Contact,
    mail = require('../mail');

function sendReminderCheckoutEmails(cb) {
  console.log('INFO: sending reminder checkout emails to contacts');
  var stream = Contact.find({ 'type': 'local', 'remindedCheckout': null, 'status': 1 }).stream();

  stream.on('data', function(contact) {
    if (contact.shouldSendReminderCheckout()) {
      var current = new Date();
      var depDate = new Date(contact.departureDate);
      var checkoutDate = new Date(current.valueOf() + (12 * 24 * 3600 * 1000));
      var mailOptions = {
        to: contact.mainEmail(false),
        subject: 'Check-out reminder',
        firstName: contact.nameGiven,
        location: contact.location,
        departureDate: depDate.toLocaleDateString(),
        checkoutDate: checkoutDate.toLocaleDateString()
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
  var stream = Contact.find({ 'type': 'local', 'status': 1, 'remindedCheckout': true}).stream();

  stream.on('data', function (contact) {
    if (contact.shouldDoAutomatedCheckout()) {
      var remindedCheckoutDate = new Date(contact.remindedCheckoutDate);
      var mailOptions = {
        to: contact.mainEmail(false),
        subject: 'Automated checkout',
        firstName: contact.nameGiven,
        location: contact.location,
        remindedCheckoutDate: remindedCheckoutDate.toLocaleDateString(),
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

exports.sendReminderCheckoutEmails = sendReminderCheckoutEmails;
exports.doAutomatedCheckout = doAutomatedCheckout;
