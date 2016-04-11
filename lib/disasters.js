"use strict";
 var models = require('../models'),
  async = require('async'),
  restify = require('restify'),
  _ = require('lodash'),
  Contact = require('../models').Contact,
  mail = require('../mail'),
  request = require('request');


// Fetch all disasters from the ReliefWeb API marked as active.
//
// Example API query for disasters, including extra fields and filtering out
// past (inactive) disasters:
// http://api.reliefweb.int/v1/disasters?fields[include][]=status&fields[include][]=glide&fields[include][]=country&filter[field]=status&filter[value]=past&filter[negate]=true&limit=1000
var iso3Countries = [];

function fetchDisasters(operations, callback) {

  var client = restify.createJsonClient({
    url: process.env.HRINFO_BASE_URL
  }),
  limit = 50,
  page = 1,
  disasters = {},
  currDate = Math.ceil(new Date().getTime()/1000),
  temp,
  diffDays,
  disaster;

  // Fetch a set of disasters, and allow recursion to get additional results.
  function fetchDisasterSet() {
    client.get('/api/v1.0/disasters?fields=id,created,operation,glide,label,reliefweb_id&range=' + limit + '&page=' + page,
      function(err, req, res, obj) {
        client.close();

        if (err) {
          return callback(err);
        }

        // Parse and combine data
        if (obj.data && obj.data.length) {
          _.forEach(obj.data, function (item) {
            if (!item.id || !item.glide) {
              console.log("INFO: Invalid disaster data: " + JSON.stringify(item));
              return;
            }
            disaster = {
              glide_id: item.glide || '',
              name: item.label || '',
              countries: [],
              created: item.created
            };
            
            temp = Math.abs(currDate - item.created);
            diffDays = Math.ceil(temp/ (3600 * 24));
              
            if (item.reliefweb_id && item.reliefweb_id.length) {
              disaster.remote_id = 'rwint:' + item.reliefweb_id;
            }
            else {
              disaster.remote_id = 'hrinfo:' + item.id;
            }
            _.forEach(item.operation, function (operation) {
              if (operations['hrinfo:' + operation.id] && operations['hrinfo:' + operation.id].iso3) {
                disaster.countries.push(operations['hrinfo:' + operation.id].iso3.toLowerCase());
                if(diffDays <=7){
                  iso3Countries[operations['hrinfo:' + operation.id].iso3.toLowerCase()] = (operations['hrinfo:' + operation.id].name);
                }
              }
            });
            if(diffDays <= 7){
              newDisasterNotification(disaster);
            }
            disasters[disaster.remote_id] = disaster;
          });
        }

        // Check for additional results
        if (obj.next && obj.next.href && obj.next.href.length) {
          page += 1;
          setTimeout(fetchDisasterSet, 500);
        }
        else {
          callback(null, disasters);
        }
      });
  }

  // Fetch the first set
  fetchDisasterSet();
}


// Store disasters in the cache.
function cacheDisasters(disasters, callback) {
  async.series([
    // Load the current disasters cache object, and merge in the new disasters.
    function (cb) {
      models.Cache.findOne({"name": "disasters"}, function (err, doc) {
        if (err) {
          return cb(err);
        }
        else if (doc && doc.data) {
          disasters = _.extend({}, doc.data, disasters);
        }
        cb();
      });
    },
    // Store the result.
    function (cb) {
      models.Cache.update({"name": "disasters"}, {"name": "disasters", "data": disasters}, {"upsert": true}, function (err, doc) {
        if (err) {
          return cb(err);
        }
        return cb(null);
      });
    }
  ], callback);
}


// Fetch disasters data and store in cache
function buildCache(callback, results) {
  fetchDisasters(results.operations, function (err, disasters) {
    if (err) {
      console.log("ERROR: Error when fetching disasters.", err);
      callback(err);
    }
    else {
      cacheDisasters(disasters, function (err) {
        if (err) {
          console.log("ERROR: Error when updating disasters cache.", err);
          callback(err);
        }
        else {
          console.log("SUCCESS: Retrieved and stored disaster data.");
          callback(null, disasters);
        }
      });
    }
  });
}


// Get the data for all disasters
function getDisasters(callback) {
  models.Cache.findOne({"name": "disasters"}, function (err, doc) {
    if (err) {
      return callback(err);
    }
    else if (doc && doc.data) {
      return callback(null, doc.data);
    }
  });
}


// Get the data for a specific disaster
function getDisaster(disasterId, callback) {
  getDisasters(function (err, disasters) {
    return callback(err, disasters ? disasters[disasterId] : null);
  });
}

function newDisasterNotification(disaster) {
  var requiredLocations = [];  
  async.series([
    function (cb) {
      if(disaster.countries.length > 0){
        async.forEachSeries(disaster.countries, function(country, callback2) {
          if (!requiredLocations[iso3Countries[country]]) {
                requiredLocations[iso3Countries[country]] = {};
                requiredLocations[iso3Countries[country]].glide = [];
                requiredLocations[iso3Countries[country]].contacts = [];
                requiredLocations[iso3Countries[country]].disasterName = [];
              }  
            requiredLocations[iso3Countries[country]].glide.push(disaster.glide_id);
            requiredLocations[iso3Countries[country]].disasterName.push(disaster.name);
            Contact.find({ $query: { type: 'local', location: iso3Countries[country]},  $orderby : {location: -1} }, function (err, contacts){
              requiredLocations[iso3Countries[country]].contacts = contacts;         
              callback2();         
          })
        }, cb);
      }
    },
    function (cb){
      var mailOptions = {};
      mailOptions.requiredLocations = requiredLocations;
      mailOptions.baseUrl = process.env.APP_BASE_URL;
      mailOptions.subject = 'New Disaster';
      if(disaster.countries.length > 0){
        async.forEachSeries(disaster.countries, function(country, cb3) { 
          async.forEachSeries(requiredLocations[iso3Countries[country]].contacts, function(contact, cb4) { 
            mailOptions.to = contact.email[0].address;
            mailOptions.nameGiven = contact.nameGiven;
            mailOptions.nameFamily = contact.nameFamily;
            mailOptions.id = contact._id;
            mailOptions.location = contact.location;
            mail.sendTemplate('new_disaster_notification', mailOptions, function (err, info) {
              if (err) {
                  console.log("ERR", err);
                }
                cb4();
            });
          })
          cb3();
        });
      }
      return cb();
    }
  ]);
}
// Expose module functions
exports.buildCache = buildCache;
exports.getAll = getDisasters;
exports.get = getDisaster;
