process.env.NODE_ENV = 'test';
var request = require('supertest'),
    should = require('should'),
    async = require('async');

var server = require('../server'),
  Client = require('../models').Client,
  Profile = require('../models').Profile,
  Contact = require('../models').Contact,
  SHA256 = require("crypto-js/sha256");

describe('claim', function() {
    var access = {
      clientId: 'test',
      clientSecret: 'Kk6a8bk@HZBs'
    };

    var access_key = SHA256(access.clientSecret);

    // authorize test app
    before(function(done) {
      async.series([
        function (cb) {
          Client.update(
          {
            clientId: access.clientId
          },
          {
            clientId: access.clientId,
            clientSecret: access.clientSecret
          },
          {
            upsert: true
          }, cb);
        },
        function (cb) {
          // add test contact
          var orphan = new Contact({
            type: 'local',
            email: [{
              address: 'test@test.com',
              type: 'work'
            }]
          });
          orphan.save(cb);
        },
        function (cb) {
          var no_login = new Profile({});
          no_login.save(function(err, profile) {
            var contact = new Contact({
              _profile: profile._id,
              type: 'global',
              email: [{
                address: 'test1@test.com',
                type: 'work'
              }]
            });
            contact.save(cb);
          });
        },
        function (cb) {
          var non_orphan = new Profile({
            firstUpdate: '1431090369759'
          });
          non_orphan.save(function (err, profile) {
            var contact = new Contact({
              _profile: profile._id,
              type: 'global',
              email: [{
                address: 'test2@test.com',
                type: 'work'
              }]
            });
            contact.save(cb);
          });
        }   
      ], done);
    
    });

    after(function (done) {
      async.series([
        function (cb) {
          // remove test data
          Contact.remove({}, function() {      
            cb();    
          });
        },
        function (cb) {
          Profile.remove({}, function() {
            cb();
          });
        },
        function (cb) {
          Client.remove({}, function() {
            cb();
          });
        }
      ], done);
    });

    it('should send claim email to orphan', function (done) {
      request(process.env.ROOT_URL)
        .post("/v0/contact/resetpw?_access_client_id=" + access.clientId + "&_access_key=" + access_key)
        .send({
          email: 'test@test.com',
          emailFlag: 'claim',
        })
        .expect(200)
        .end(function(err, res) {
          if (err) return done(err);
          res.body.status.should.equal('ok');
          done();
        });
    });

    it('should send claim email to user who never logged in', function (done) {
      request(process.env.ROOT_URL)
        .post("/v0/contact/resetpw?_access_client_id=" + access.clientId + "&_access_key=" + access_key)
        .send({
          email: 'test1@test.com',
          emailFlag: 'claim',
        })
        .expect(200)
        .end(function(err, res) {
          if (err) return done(err);
          res.body.status.should.equal('ok');
          done();
        });
    });

    it('should not send a claim email to a non-orphan account', function (done) {
      request(process.env.ROOT_URL)
        .post("/v0/contact/resetpw?_access_client_id=" + access.clientId + "&_access_key=" + access_key)
        .send({
          email: 'test2@test.com',
          emailFlag: 'claim',
        })
        .expect(200)
        .end(function(err, res) {
          if (err) return done(err);
          res.body.status.should.equal('error');
          res.body.message.should.equal('Can not send a claim email to a non-orphan account');
          done();
        });
    });
});
