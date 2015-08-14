process.env.NODE_ENV = 'test';
var should = require('should');

var Contact = require('../models').Contact;

describe('reminder_checkout email', function() {

    it('should not send to global contact', function (done) {
      var global = new Contact({
        type: 'global',
        departureDate: '2010-08-11T22:00:00.000Z',
        email: [{
          address: 'test@test.com',
        }],
        status: 1
      });
      var out = global.shouldSendReminderCheckout();
      should(out).eql(false);
      done();
    });

    it('should not send to already checked out contact', function (done) {
      var checked_out = new Contact({
        type: 'local',
        departureDate: '2010-08-11T22:00:00.000Z',
        email: [{
          address: 'test@test.com',
        }],
        status: 0
      });
      var out = checked_out.shouldSendReminderCheckout();
      should(out).eql(false);
      done();
    });

    it('should not send to contact with no departure date', function (done) {
      var no_dep = new Contact({
        type: 'local',
        departureDate: null,
        email: [{
          address: 'test@test.com',
        }],
        status: 1
      });
      var out = no_dep.shouldSendReminderCheckout();
      should(out).eql(false);
      done();
    });

    it('should not send to contact with departure date in the future', function (done) {
      var future = new Contact({
        type: 'local',
        departureDate: '2025-08-11T22:00:00.000Z',
        email: [{
          address: 'test@test.com',
        }],
        status: 1
      });
      var out = future.shouldSendReminderCheckout();
      should(out).eql(false);
      done();
    });

    it('should not send to contact with reminder_checkout set to true', function (done) {
      var reminded = new Contact({
        type: 'local',
        departureDate: '2010-08-11T22:00:00.000Z',
        email: [{
          address: 'test@test.com',
        }],
        status: 1,
        remindedCheckout: true
      });
      var out = reminded.shouldSendReminderCheckout();
      should(out).eql(false);
      done();
    });

    it('should not send to contact with departure date passed by less than 48 hours', function (done) {
      var current = new Date();
      var depDate = new Date(current - (47 * 3600 * 1000));
      var reminded = new Contact({
        type: 'local',
        departureDate: depDate.toISOString(),
        email: [{
          address: 'test@test.com',
        }],
        status: 1
      });
      var out = reminded.shouldSendReminderCheckout();
      should(out).eql(false);
      done();
    });

    it('should send to local contact with no reminder_checkout and departure date passed by 48 hours', function (done) {
      var contact = new Contact({
        type: 'local',
        departureDate: '2010-08-11T22:00:00.000Z',
        email: [{
          address: 'test@test.com',
        }],
        status: 1
      });
      var out = contact.shouldSendReminderCheckout();
      should(out).eql(true);
      done();
    });

});
