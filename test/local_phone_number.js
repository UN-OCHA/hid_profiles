process.env.NODE_ENV = 'test';
var should = require('should'),
    operations = require('../lib/operations');

var Contact = require('../models').Contact;

describe('has local phone number', function() {

    // build operations cache
    before(function(done) {
      operations.buildCache(function (err, operations) {
        done();
      });
    });

    it('should reply false when testing a global profile', function (done) {
      var contact = new Contact({
        type: 'global',
        phone: [{
          countryCode: '93',
          number: '+93201231234',
          type: 'Landline'
        }],
        status: true
      });
      contact.hasLocalPhoneNumber(function (err, out) {
        if (err) return done(err);
        should(out).eql(false);
        done();
      });
    });

    it('does not have any phone number', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Afghanistan',
        locationId: 'hrinfo:82',
        phone: [],
        status: true
      });
      contact.hasLocalPhoneNumber(function (err, out) {
        should(out).eql(false);
        done();
      })
    });

    it('does not have a local phone number', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Afghanistan',
        locationId: 'hrinfo:82',
        phone: [{
          countryCode: '33',
          number: '+33486582332',
          type: 'Landline'
        }],
        status: true
      });
      contact.hasLocalPhoneNumber(function (err, out) {
        should(out).eql(false);
        done();
      })
    });

    it('should have a local phone number', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Afghanistan',
        locationId: 'hrinfo:82',
        phone: [{
          countryCode: '33',
          number: '+33486582332',
          type: 'Landline'
        },
        {
          countryCode: '93',
          number: '+93201231234',
          type: 'Landline'
        }],
        status: true
      });
      contact.hasLocalPhoneNumber(function (err, out) {
        should(out).eql(true);
        done();
      })
    });

});
