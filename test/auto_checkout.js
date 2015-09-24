process.env.NODE_ENV = 'test';
var should = require('should');

var Contact = require('../models').Contact;

describe('automated checkout testing', function() {

    it('should not automatically checkout a global contact', function (done) {
      var global = new Contact({
        type: 'global',
        departureDate: '2010-08-11T22:00:00.000Z',
        email: [{
          address: 'test@test.com',
        }],
        remindedCheckout: true,
        status: true
      });
      var out = global.shouldDoAutomatedCheckout();
      should(out).eql(false);
      done();
    });

    it('should not automatically checkout if no reminder checkout email was sent', function (done) {
      var no_dep = new Contact({
        type: 'local',
        departureDate: '2010-08-11T22:00:00.000Z',
        email: [{
          address: 'test@test.com',
        }],
       status: true
      });
      var out = no_dep.shouldDoAutomatedCheckout();
      should(out).eql(false);
      done();
    });

    it('should not automatically checkout if the date of the reminder checkout email is passed by less than 12 days', function (done) {
      var current = new Date();
      var checkoutEmailDate = new Date(current - (11 * 24 * 3600 * 1000));
      var reminded = new Contact({
        type: 'local',
        email: [{
          address: 'test@test.com',
        }],
        status: true,
        remindedCheckout: true,
        remindedCheckoutDate: checkoutEmailDate.toISOString()
      });
      var out = reminded.shouldDoAutomatedCheckout();
      should(out).eql(false);
      done();
    });

    it('should not automatically checkout an already checked out contact', function (done) {
      var contact = new Contact({
        type: 'local',
        departureDate: '2010-08-11T22:00:00.000Z',
        email: [{
          address: 'test@test.com',
        }],
        status: false,
        remindedCheckout: true,
        remindedCheckoutDate: '2010-08-11T22:00:00.000Z'
      });
      var out = contact.shouldDoAutomatedCheckout();
      should(out).eql(false);
      done();
    });

    it('should not automatically checkout a contact who updated its departure date after receiving the reminder_checkout email', function (done) {
      var contact = new Contact({
        type: 'local',
        departureDate: '2010-08-11T22:00:00.000Z',
        email: [{
          address: 'test@test.com',
        }],
        status: false,
        remindedCheckout: true,
        remindedCheckoutDate: '2010-08-11T22:00:00.000Z'
      });
      contact.departureDate = '2025-08-11T22:00:00.000Z';
      var out = contact.shouldDoAutomatedCheckout();
      should(out).eql(false);
      done();
    });

    it('should automatically checkout if the date of the reminder checkout email is passed by more than 12 days', function (done) {
      var contact = new Contact({
        type: 'local',
        departureDate: '2010-08-11T22:00:00.000Z',
        email: [{
          address: 'test@test.com',
        }],
        remindedCheckout: true,
        remindedCheckoutDate: '2010-08-11T22:00:00.000Z',
        status: true
      });
      var out = contact.shouldDoAutomatedCheckout();
      should(out).eql(true);
      done();
    });

    after(function(done) {
      Contact.remove({}, function() {
        done();
      });
    });

});
