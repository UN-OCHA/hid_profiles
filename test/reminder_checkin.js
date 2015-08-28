process.env.NODE_ENV = 'test';
var should = require('should'),
    operations = require('../lib/operations'),
    offices = require('../lib/offices'),
    async = require('async');

var Contact = require('../models').Contact;

describe('should send reminder checkin', function() {

    this.timeout(0); // it can take a while to build the operations cache, so deactivate timeout

    // build operations cache
    before(function(done) {
      async.auto({
        operations: operations.buildCache,
        offices: offices.fetchOffices,
        appData: ['operations', 'offices', operations.buildAppData]
      },
      function (err, results) {
        done();
      });
    });

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

    it('should send reminder checkin if there is no created date', function (done) {
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
        status: true
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        should(out).eql(true);
        done();
      })
    });

    it('should not send reminder checkin if it was already sent', function (done) {
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
          number: '+33486582332',
          type: 'Landline'
        }],
        created: '1437055382885',
        status: true,
        remindedCheckin: d.valueOf() - 48
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

    it('should send reminder checkin because of missing local phone number', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Nepal',
        locationId: 'hrinfo:85',
        address: [{
          administrative_area: 'Central',
          country: 'Nepal'
        }],
        office: [{
          _id: '55df18f5dec506cc013b8fc1',
          name: 'Charikot sub-office',
          remote_id: 'hrinfo_off_105992'
        }],
        phone: [{
          number: '+33 486581234',
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

    it('should send reminder checkin because of missing admin area', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Nepal',
        locationId: 'hrinfo:85',
        address: [{
          administrative_area: '',
          country: 'Nepal'
        }],
        office: [{
          _id: '55df18f5dec506cc013b8fc1',
          name: 'Charikot sub-office',
          remote_id: 'hrinfo_off_105992'
        }], 
        phone: [{
          number: '+977 9818571272',
          type: 'Mobile'
        }],
        created: '1437055382885',
        status: true
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        should(out).eql(true);
        done();
      })
    });

    it('should send reminder checkin because of missing office', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Nepal',
        locationId: 'hrinfo:85',
        address: [{
          administrative_area: 'Central',
          country: 'Nepal'
        }],
        office: [],
        phone: [{
          number: '+977 9818571272',
          type: 'Mobile'
        }],
        created: '1437055382885',
        status: true
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        should(out).eql(true);
        done();
      })
    });

    it('should send reminder checkin because contact is not in country', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Nepal',
        locationId: 'hrinfo:85',
        address: [{
          administrative_area: 'Central',
          country: 'France'
        }],
        office: [{
          _id: '55df18f5dec506cc013b8fc1',
          name: 'Charikot sub-office',
          remote_id: 'hrinfo_off_105992'
        }],
        phone: [{
          number: '+977 9818571272',
          type: 'Mobile'
        }],
        created: '1437055382885',
        status: true
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        should(out).eql(true);
        done();
      })
    });

    it('should not send reminder checkin', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Nepal',
        locationId: 'hrinfo:85',
        address: [{
          administrative_area: 'Central',
          country: 'Nepal'
        }],
        office: [{
          _id: '55df18f5dec506cc013b8fc1',
          name: 'Charikot sub-office',
          remote_id: 'hrinfo_off_105992'
        }],
        phone: [{
          number: '+977 9818571272',
          type: 'Mobile'
        }],
        created: '1437055382885',
        status: true
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        should(out).eql(false);
        done();
      })
    });

    it('should not send reminder checkin if missing office and country with no coordination hub', function (done) {
      var contact = new Contact({
        type: 'local',
        location: 'Angola',
        locationId: 'hrinfo:46',
        address: [{
          administrative_area: 'Central',
          country: 'Angola'
        }],
        office: [],
        phone: [{
          number: '+244 231 123 456',
          type: 'Mobile'
        }],
        created: '1437055382885',
        status: true
      });
      contact.shouldSendReminderCheckin(function (err, out) {
        should(out).eql(false);
        done();
      })
    });

});
