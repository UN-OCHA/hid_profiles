process.env.NODE_ENV = 'test';
var should = require('should');

var Contact = require('../models').Contact;

describe('reminder_update email', function() {

    it('should not send to global contact if revised less than 6 months ago', function (done) {
      var d = new Date();
      var contact = new Contact({
        type: 'global',
        revised: d.valueOf() - 48 * 3600 * 1000,
        status: true
      });
      var out = contact.shouldSendReminderUpdate();
      should(out).eql(false);
      done();
    });

    it('should send to global contact if revised more than 6 months ago', function (done) {
      var d = new Date();
      var contact = new Contact({
        type: 'global',
        revised: d.valueOf() - 200 * 24 * 3600 * 1000,
        status: true
      });
      var out = contact.shouldSendReminderUpdate();
      should(out).eql(true);
      done();
    });

    it('should not send to local contact if checked out', function (done) {
      var d = new Date();
      var contact = new Contact({
        type: 'local',
        revised: d.valueOf() - 200 * 24 * 3600 * 1000,
        status: false
      });
      var out = contact.shouldSendReminderUpdate();
      should(out).eql(false);
      done();
    });

    it('should send to local contact if revised more than 6 months ago', function (done) {
      var d = new Date();
      var contact = new Contact({
        type: 'local',
        revised: d.valueOf() - 200 * 24 * 3600 * 1000,
        status: true
      });
      var out = contact.shouldSendReminderUpdate();
      should(out).eql(true);
      done();
    });

    it('should not send to contact if reminded less than 6 months ago', function (done) {
      var d = new Date();
      var contact = new Contact({
        type: 'local',
        revised: d.valueOf() - 200 * 24 * 3600 * 1000,
        remindedUpdate: d.valueOf() - 48 * 3600 * 1000,
        status: true
      });
      var out = contact.shouldSendReminderUpdate();
      should(out).eql(false);
      done();
    });

    it('should send to contact if reminded more than 6 months ago', function (done) {
      var d = new Date();
      var contact = new Contact({
        type: 'local',
        revised: d.valueOf() - 400 * 24 * 3600 * 1000,
        remindedUpdate: d.valueOf() - 200 * 24 * 3600 * 1000,
        status: true
      });
      var out = contact.shouldSendReminderUpdate();
      should(out).eql(true);
      done();
    });

    it('should send to contact with no revised date created more than 6 months ago', function (done) {
      var d = new Date();
      var contact = new Contact({
        type: 'local',
        created: d.valueOf() - 400 * 24 * 3600 * 1000,
        status: true
      });
      var out = contact.shouldSendReminderUpdate();
      should(out).eql(true);
      done();
    });

    it('should not send to contact with no revised date created less than 6 months ago', function (done) {
      var d = new Date();
      var contact = new Contact({
        type: 'local',
        created: d.valueOf() - 48 * 3600 * 1000,
        status: true
      });
      var out = contact.shouldSendReminderUpdate();
      should(out).eql(false);
      done();
    });

    it('should not send to contact with no revised date and no created date', function (done) {
      var contact = new Contact({
        type: 'local',
        status: true
      });
      var out = contact.shouldSendReminderUpdate();
      should(out).eql(false);
      done();
    });

});
