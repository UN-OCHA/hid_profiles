process.env.NODE_ENV = 'test';
var should = require('should'),
    operations = require('../lib/operations');

var Contact = require('../models').Contact;

describe('should send reminder checkin', function() {

    it('should not send reminder checkin to global contact', function (done) {
      var contact = new Contact({
        type: 'global',
        phone: [{
          countryCode: '93',
          number: '+93201231234',
          type: 'Landline'
        }],
        created: '1437055382885',
        status: true
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        if (err) return done(err);
        should(out).eql(false);
        done();
      });
    });

    it('should not send reminder checkin if created date is not older than 48 hours', function (done) {
      var d = new Date();
      var contact = new Contact({
        type: 'local',
        location: 'Afghanistan',
        locationId: 'hrinfo:82',
        address: [{
          country: 'Afghanistan'
        }],
        phone: [{
          countryCode: '33',
          number: '+33412852356',
          type: 'Landline'
        }],
        created: d.valueOf() - 3600000,
        status: true
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        should(out).eql(false);
        done();
      })
    });

    it('should not send reminder checkin if it was already sent', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Afghanistan',
        locationId: 'hrinfo:82',
        address: [{
          country: 'Afghanistan'
        }],
        phone: [{
          countryCode: '33',
          number: '+33486582332',
          type: 'Landline'
        }],
        created: '1437055382885',
        status: true,
        remindedCheckin: true
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        should(out).eql(false);
        done();
      })
    });

    it('should not send reminder checkin to checked out contact', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Afghanistan',
        locationId: 'hrinfo:82',
        address: [{
          country: 'Afghanistan'
        }],
        phone: [{
          countryCode: '33',
          number: '+33486582332',
          type: 'Landline'
        }],
        created: '1437055382885',
        status: false
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        should(out).eql(false);
        done();
      })
    });

    it('should send reminder checkin', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Afghanistan',
        locationId: 'hrinfo:82',
        address: [{
          country: 'Afghanistan'
        }],
        phone: [{
          countryCode: '33',
          number: '+33486582332',
          type: 'Landline'
        }],
        created: '1437055382885',
        status: true
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        should(out).eql(true);
        done();
      })
    });

});
