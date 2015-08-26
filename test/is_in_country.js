process.env.NODE_ENV = 'test';
var should = require('should');

var Contact = require('../models').Contact;

describe('is in country', function() {

    it('should reply false on a global profile', function (done) {
      var contact = new Contact({
        type: 'global',
        address: [{
          country: 'Afghanistan',
        }],
        status: true
      });
      var out = contact.isInCountry();
      should(out).eql(false);
      done();
    });

    it('should reply false on a checked out profile', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Afghanistan',
        locationId: 'hrinfo:82',
        address: [{
          country: 'Afghanistan'
        }],
        status: false
      });
      var out = contact.isInCountry();
      should(out).eql(false);
      done();
    });

    it('is not in country', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Afghanistan',
        locationId: 'hrinfo:82',
        address: [{
          country: 'France'
        }],
        status: true
      });
      var out = contact.isInCountry();
      should(out).eql(false);
      done();
    });

    it('is in country', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Afghanistan',
        locationId: 'hrinfo:82',
        address: [{
          country: 'Afghanistan'
        }],
        status: true
      });
      var out = contact.isInCountry();
      should(out).eql(true);
      done();
    });


});
