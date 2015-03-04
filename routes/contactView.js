var Contact = require('../models').Contact,
  log = require('../log'),
  stringify = require('csv-stringify'),
  _ = require('lodash');

function get(req, res, next) {
  var docs = {},
    query = {},
    range = {skip: 0, limit: 0},
    contactSchema = Contact.schema.paths;

  for (var prop in req.query) {
    if (req.query.hasOwnProperty(prop) && req.query[prop]) {
      var val = typeof req.query[prop] === 'String' ? req.query[prop] : String(req.query[prop]);
      if (!val || !val.length) {
        continue;
      }

      if (range.hasOwnProperty(prop)) {
        range[prop] = parseInt(val) || range[prop];
      }
      else if (prop == '_id' || prop == '_profile') {
        query[prop] = val;
      }
      else if (prop == 'text') {
        query['$or'] = [
          {jobtitle: new RegExp(val, "i")},
          {nameGiven: new RegExp(val, "i")},
          {nameFamily: new RegExp(val, "i")},
          {notes: new RegExp(val, "i")},
          {'organization.name': new RegExp(val, "i")}
        ];
      }
      else if (recusiveSchemaCheck(contactSchema, prop.split('.'))) {
        query[prop] = val;
      }
    }
  }
  var result = {},
    contacts = [],
    count = 0;

  Contact
    .count(query)
    .exec(function (err, _count) {
      if (err) {
        log.warn({'type': 'contactView:error', 'message': 'Error occurred while performing query for contacts count.', 'err': err});
        result = {status: "error", message: "Query failed for contacts count."};
      }
      else {
        count = _count
      }
    });

  Contact
    .find(query)
    .skip(range.skip)
    .limit(range.limit)
    .sort({nameGiven: 1, nameFamily: 1})
    .populate('_profile')
    .exec(function (err, _contacts) {
      if (err) {
        log.warn({'type': 'contactView:error', 'message': 'Error occurred while performing query for contacts.', 'err': err});
        result = {status: "error", message: "Query failed for contacts."};
      }
      else {
        if (_contacts && _contacts.length) {
          contacts = _contacts;

          if (req.query.hasOwnProperty("verified") && req.query.verified) {
            contacts = _contacts.filter(function (item) {
              return item._profile && item._profile.verified;
            });
          }
        }

        if (req.query.export && ((req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) || (req.apiAuth.mode === 'user' && req.apiAuth.userId))) {
          var csvData = '',
            stringifier = stringify({'quoted': true});

          stringifier.on('readable', function() {
            while (row = stringifier.read()) {
              csvData += row;
            }
          });
          stringifier.on('error', function(err) {
            log.warn({'type': 'contactView:error', 'message': 'Error occurred while reading stringifier to generate CSV.', 'err': err});
          });
          stringifier.on('finish', function() {
            res.charSet('utf-8');
            res.writeHead(200, {
              'Content-Length': Buffer.byteLength(csvData),
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': 'attachment; filename="contacts.csv"'
            });
            res.write(csvData);
            res.end();
          });

          stringifier.write([
            'Given Name',
            'Family Name',
            'Job Title',
            'Organization',
            'Groups',
            'Country',
            'Admin Area',
            'Locality',
            'Phone:Landline',
            'Phone:Mobile',
            'Phone:Fax',
            'Phone:Satellite',
            'VOIP',
            'Email',
            'Email:Work',
            'Email:Personal',
            'Email:Other',
            'URI'
          ]);


          _.forEach(contacts, function (item) {
            var multiValues = {
                  email: {
                    key: 'address',
                    types: {'Email':[], 'Work':[],'Personal':[], 'Other':[]}
                  },
                  phone: {
                    key: 'number',
                    types:{'Landline':[], 'Mobile':[], 'Fax':[], 'Satellite':[]}
                  },
                  voip: {
                    key: 'number',
                    types: {'Voip': []}
                  }
                }

            _.forEach(multiValues, function(value, fieldType) {
              _.forEach(item[fieldType], function(fieldEntry) {
                if (typeof fieldEntry[value.key] !== 'undefined') {
                  if (typeof fieldEntry.type !== 'undefined' && typeof value.types[fieldEntry.type] !==  'undefined') {
                    multiValues[fieldType].types[fieldEntry.type].push(fieldEntry[value.key])
                  }
                  else {
                    var capKey = fieldType.charAt(0).toUpperCase() + fieldType.slice(1)
                        fieldValue = (typeof fieldEntry.type === 'undefined') ? fieldEntry[value.key] : fieldEntry.type + ": " + fieldEntry[value.key];

                    multiValues[fieldType].types[capKey].push(fieldValue);
                  }
                }
              });
            });

            stringifier.write([
              item.nameGiven,
              item.nameFamily,
              item.jobtitle,
              item.organization.map(function (val) { if (val.name) { return val.name; } }).join('; '),
              item.bundle.join('; '),
              item.address && item.address[0] && item.address[0].country ? item.address[0].country : '',
              item.address && item.address[0] && item.address[0].administrative_area ? item.address[0].administrative_area : '',
              item.address && item.address[0] && item.address[0].locality ? item.address[0].locality : '',
              multiValues.phone.types['Landline'].join('; '),
              multiValues.phone.types['Mobile'].join('; '),
              multiValues.phone.types['Fax'].join('; '),
              multiValues.phone.types['Satellite'].join('; '),
              multiValues.voip.types['Voip'].join('; '),
              multiValues.email.types['Email'].join('; '),
              multiValues.email.types['Work'].join('; '),
              multiValues.email.types['Personal'].join('; '),
              multiValues.email.types['Other'].join('; '),
              item.uri ? item.uri.join('; '): ''
            ]);
          });

          stringifier.end();
          return;
        }

        result = {status: "ok", contacts: contacts, count: count};
        log.info({'type': 'contactView:success', 'message': 'Successfully returned data for contactView query.', 'query': query, 'range': range});
      }
      res.send(result);
    });

  // Recursively check schema for properties in array.
  function recusiveSchemaCheck(schema, propArray) {
    var prop = propArray.shift();
    if (schema.hasOwnProperty(prop)) {
      if (propArray.length  && schema[prop].hasOwnProperty('schema')) {
        return recusiveSchemaCheck(schema[prop].schema.paths, propArray);
      }
      else {
        return true;
      }
    }
    else {
      return false;
    }
  }
}

exports.get = get;
