var Contact = require('../models').Contact,
  Cache = require('../models').Cache,
  config = require('../config'),
  log = require('../log'),
  protectedRoles = require('../lib/protectedRoles'),
  stringify = require('csv-stringify'),
  _ = require('lodash'),
  async = require('async'),
  fs = require('fs'),
  Handlebars = require('handlebars'),
  restify = require('restify'),
  moment = require('moment'),
  qs = require('querystring'),
  http = require('http');

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
        var exp = {
          $regex: val.replace(/\s{1,}/g, '|'),
          $options: 'i'
        };

        query['$or'] = [
          {'address.administrative_area': exp},
          {'address.country': exp},
          {'address.locality': exp},
          {bundle: exp},
          {'email.address': exp},
          {jobtitle: exp},
          {nameGiven: exp},
          {nameFamily: exp},
          {notes: exp},
          {'organization.name': exp},
          {'phone.number': exp},
          {protectedRoles: exp},
          {uri: exp},
          {'voip.number': exp}
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

        if (req.query.export && req.query.export === 'csv' && ((req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) || (req.apiAuth.mode === 'user' && req.apiAuth.userId))) {
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
            log.info({'type': 'contactViewCSV:success', 'message': 'Successfully generated CSV data for contactView query.', 'query': query, 'range': range});
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
                    defaultType: 'Email',
                    types: {'Email':[], 'Work':[],'Personal':[], 'Other':[]}
                  },
                  phone: {
                    key: 'number',
                    defaultType: 'Landline',
                    types:{'Landline':[], 'Mobile':[], 'Fax':[], 'Satellite':[]}
                  },
                  voip: {
                    key: 'number',
                    defaultType: 'Voip',
                    types: {'Voip': []}
                  }
                };

            _.forEach(multiValues, function(value, fieldType) {
              _.forEach(item[fieldType], function(fieldEntry) {
                console.log('fieldEntry', fieldEntry)
                // Make sure actual value is defined.
                if (typeof fieldEntry[value.key] !== 'undefined') {
                  // Type is defined and is one of the predefined accepted values.
                  if (typeof fieldEntry.type !== 'undefined' && typeof value.types[fieldEntry.type] !==  'undefined') {
                    multiValues[fieldType].types[fieldEntry.type].push(fieldEntry[value.key]);
                  }
                  // If type is defined but not one of the accepted values,
                  // append it to the field value and add it to the default array.
                  else if (typeof fieldEntry.type !== 'undefined') {
                    multiValues[fieldType].types[value.defaultType].push(fieldEntry.type + ": " + fieldEntry[value.key] );
                  }
                  // Otherwise add value to default array.
                  else {
                    multiValues[fieldType].types[value.defaultType].push(fieldEntry[value.key]);
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
        else if (req.query.export && req.query.export === 'pdf' && ((req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) || (req.apiAuth.mode === 'user' && req.apiAuth.userId))) {
          var listTitle = '',
            protectedRolesData = null,
            templateData = null;

          async.series([
            function (cb) {
              if (query.type !== 'global' && query.locationId && query.locationId !== 'global') {
                Cache.findOne({"name": "operations"}, function (err, doc) {
                  _.forEach(doc.data, function (item) {
                    _.forEach(item, function (operation, opId) {
                      if (opId.length && opId == query.locationId && operation.name && operation.name.length) {
                        listTitle = operation.name;
                      }
                    });
                  });
                  return cb();
                });
              }
              else {
                listTitle = 'Global';
                return cb();
              }
            },
            function (cb) {
              // Load protected roles data
              protectedRoles.get(function (err, roles) {
                protectedRolesData = roles;
                cb();
              });
            },
            function (cb) {
              // Load the printList.html template, compile it with Handlebars, and
              // generate HTML output for the list.
              fs.readFile('views/printList.html', function (err, data) {
                if (err) throw err;
                templateData = data;
                cb();
              });
            }
          ], function (err, results) {
            var filters = [];
            if (req.query.hasOwnProperty('text') && req.query.text.length) {
              filters.push(req.query.text);
            }
            _.each(query, function (val, key) {
              if (['address.administrative_area', 'address.locality', 'bundle', 'organization.name'].indexOf(key) !== -1) {
                filters.push(query[key]);
              }
              else if (key == 'protectedRoles') {
                var prIndex = _.findIndex(protectedRolesData, function (item) {
                  return (item.id == val);
                });
                filters.push(protectedRolesData[prIndex].name);
              }
            });
            if (req.query.hasOwnProperty('keyContact') && req.query.keyContact) {
              filters.push('Key Contact');
            }
            if (req.query.hasOwnProperty('verified') && req.query.verified) {
              filters.push('Verified User');
            }

            var template = Handlebars.compile(String(templateData)),
              isGlobal = (query.type === 'global' || !query.locationId || !query.locationId.length),
              tokens = {
                appBaseUrl: config.appBaseUrl,
                listTitle: listTitle,
                isGlobal: isGlobal,
                queryCount: contacts.length,
                filters: filters,
                dateGenerated: moment().format('LL'),
                contacts: contacts
              },
              result = template(tokens),
              postData = qs.stringify({
                'html' : result
              }),
              options = {
                hostname: config.wkhtmltopdfHost,
                port: config.wkhtmltopdfPort || 80,
                path: '/htmltopdf',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Content-Length': postData.length
                }
              },
              clientReq;

            // Send the HTML to the wkhtmltopdf service to generate a PDF, and
            // return the output.
            clientReq = http.request(options, function(clientRes) {
              if (clientRes && clientRes.statusCode == 200) {
                clientRes.setEncoding('binary');

                var pdfSize = parseInt(clientRes.header("Content-Length")),
                  pdfBuffer = new Buffer(pdfSize),
                  bytes = 0;

                clientRes.on("data", function(chunk) {
                  pdfBuffer.write(chunk, bytes, "binary");
                  bytes += chunk.length;
                });

                clientRes.on("end", function() {
                  res.writeHead(200, {
                    'Content-Length': bytes,
                    'Content-Type': 'application/pdf'
                  });
                  res.end(pdfBuffer);
                  log.info({'type': 'contactViewPDF:success', 'message': 'Successfully generated PDF data for contactView query.', 'query': query, 'range': range});
                });
              }
              else {
                log.warn({'type': 'contactViewPDF:error', 'message': 'An error occured while generating PDF.', 'clientRes': clientRes});
                res.send(500, "An error occured while generating PDF.");
                res.end();
              }
            });

            // Handle errors with the HTTP request.
            clientReq.on('error', function(e) {
              log.warn({'type': 'contactViewPDF:error', 'message': 'An error occured while requesting the PDF generation: ' + e.message, 'error': e});
              res.send(500, "An error occurred while requesting the PDF generation.");
              res.end();
            });

            // Write post data containing the rendered HTML.
            clientReq.write(postData);
            clientReq.end();
          });
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
