var _ = require('lodash'),
  	restify = require('restify'),
	_ = require('lodash'),
  	Contact = require('../models').Contact,
	Profile = require('../models').Profile,
	cartodb = require('cartodb'),
	async = require('async');


//Adds all existing local contacts in the cartodb database 
function addToCartodb() {
  var sql_query = "TRUNCATE " + process.env.CARTODB_TABLE;
  var csql = new cartodb.SQL({ user: process.env.CARTODB_DOMAIN, api_key: process.env.CARTODB_API_KEY});
  csql.execute(sql_query);
  var locations = [];

  Contact.find({type: 'local'}, function (err, contacts) {
    async.eachSeries(contacts, function (contact, cb) {
      var op_id = contact.locationId.replace('hrinfo:', '');
      getLocation(op_id, locations, function (loc) {
        if (loc) {
          locations[op_id] = loc;
          if (loc.country) {
            var lat = loc.country.geolocation.lat;
            var lon = loc.country.geolocation.lon;
            var org_name = contact.organization[0] && contact.organization[0].name ? contact.organization[0].name.replace("'", "''") : '';
            var origin_location = contact.address[0] && contact.address[0].country ? contact.address[0].country.replace("'", "''") : '';
            var location_country = loc.country.label ? loc.country.label.replace("'", "''") : '';
            var created = {};
            if (contact.created) {
              created = new Date(contact.created);
            }
            else {
              created = new Date('2015-01-01T08:52:59+00:00');
              if (location_country == 'Philippines') {
                created = new Date("2015-03-01T08:52:59+00:00");
              }
              if (location_country == 'Nepal') {
                created = new Date("2015-04-28T08:52:59+00:00");
              }
            }
            var sql_query = "INSERT INTO " + process.env.CARTODB_TABLE + " (the_geom, hid_id, org_name, last_updated, origin_location, location_country, operation_id) VALUES (";
            sql_query = sql_query + "'SRID=4326; POINT (" + lon + " " + lat + ")', '" + contact._id.toString() + "', '" + org_name + "', '" + created.toISOString() + "', '" + origin_location + "', '" + location_country + "', '" + op_id +
"')";
            // Execute the cartodb query
            csql.execute(sql_query).done(function (data) {
              cb();
            }).error(function (error) {
              console.log(error);
              console.log(sql_query);
              cb();
            });
          }
          else { 
            cb();
          }
        }
        else {
          cb();
        }
      });
    }, function () {
      process.exit();
    });
  });

}

function getLocation(id, locations, cb) {
  if (locations[id]) {
    return cb(locations[id]);
  }
  else {
    var restclient = restify.createJsonClient({
      url: 'https://www.humanitarianresponse.info'
    });
    restclient.get('/api/v1.0/operations/' + id, function (err, req, res, obj) {
      if (!err && obj.data && obj.data.length) {
        return cb(obj.data[0]);
      }
      else {
        return cb(null);
      }
    });
  }
}

addToCartodb();
