var async = require('async'),
  _ = require('lodash'),
  config = require('../config'),
  operations = require('../lib/operations'),
  List = require('../models').List,
  Profile = require('../models').Profile,
  stringify = require('csv-stringify'),
  roles = require('../lib/roles'),
  orgTypes = require('../lib/orgTypes'),
  protectedRoles = require('../lib/protectedRoles'),
  disasters = require('../lib/disasters'),
  stringify = require('csv-stringify'),
  fs = require('fs'),
  moment = require('moment'),
  qs = require('querystring'),
  http = require('http'),
  Handlebars = require('handlebars');

function get(req, res, next) {
  var lockedOperations = [];
  async.series([
    function(cb) {
      operations.getLockedOperations(function (err, _lockedOperations) {
        if (err) {
          return cb(err);
        }
        lockedOperations = _lockedOperations;
      });

      cb();
    },
    function(cb) {
      if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
        Profile.findOne({userid: req.apiAuth.userId}, function (err, profile) {
          if (err) {
            return cb(err);
          }

          if (!err && profile && profile._id) {
            if (!profile.verified) {
              req.limitContacts = true;
            }
          }
        });
      }

      cb();
    },
  ], function(err) {
    if (err) {
      return res.json({status: "error", message: "Could not view contact list."});
    }
    // Only find lists that users have access to.
    if (req.query.id) {
      List.findOne({_id:req.query.id})
      .populate('contacts')
      .exec(function (err, list) {
        if (err) {
          return res.json({status: "error", message: "There was an error retrieving the custom contact list."});
        }

        // Trusted Apis & Verified User
        if (req.limitContacts) {
          var contacts = [];
          _.forEach(list.contacts, function(contact) {
            if (lockedOperations.indexOf(contact.locationId) == -1) {
              contacts.push(contact);
            }
          });
          list.contacts = contacts;
        }
        var totalCount = list.contacts.length;
        var contacts = list.contacts;

        if (req.query.hasOwnProperty('address.country')) {
          contacts = contacts.filter(function(contact){
            if (contact.address.length > 0) {
              return contact.address.map(function(c) { return c.country; }).indexOf(req.query['address.country']) != -1;
            } else {
              return false;
            }
          });
        }

        if (req.query.hasOwnProperty('organization.name')) {
          contacts = contacts.filter(function(contact){
            if (contact.organization.length > 0) {
              return contact.organization.map(function(c) { return c.name; }).indexOf(req.query['organization.name']) != -1;
            } else {
              return false;
            }
          });
        }

        if (req.query.hasOwnProperty('organization.org_type_remote_id')) {
          contacts = contacts.filter(function(contact){
            if (contact.organization.length > 0) {
              return contact.organization.map(function(c) { return c.org_type_remote_id; }).indexOf(req.query['organization.org_type_remote_id']) != -1;
            } else {
              return false;
            }
          });
        }

        if (req.query.hasOwnProperty('disasters.remote_id')) {
          contacts = contacts.filter(function(contact){
            if (contact.disasters.length > 0) {
              return contact.disasters.map(function(c) { return c.remote_id; }).indexOf(req.query['disasters.remote_id']) != -1;
            } else {
              return false;
            }
          });
        }

        if (req.query.hasOwnProperty('protectedRoles')) {
          contacts = contacts.filter(function(contact){
            if (contact.protectedRoles.length > 0) {
              return contact.protectedRoles.indexOf(req.query['organization.org_type_remote_id']) != 1;
            } else {
              return false;
            }
          });
        }

        if (req.query.hasOwnProperty('keyContact')) {
          contacts = contacts.filter(function(contact){
            return contact.keyContact == req.query['keyContact'];
          });
        }

        if (req.query.hasOwnProperty('verified')) {
          contacts = contacts.filter(function(contact){
            return contact.verified == req.query['verified'];
          });
        }

        if (req.query.hasOwnProperty('text')) {
          var textRegExp = new RegExp(req.query['text'].toLowerCase());
          contacts = contacts.filter(function(contact){
            return textRegExp.test(contact.nameGiven.toLowerCase()) ||
              textRegExp.test(contact.nameFamily.toLowerCase());
          });
        }
        list.contacts = contacts;

        if (req.query.export && req.query.export === 'pdf') {
          getReturnPDF(list, req, res);
        } else if (req.query.export && req.query.export === 'csv') {
          getReturnCSV(list.contacts, list.contacts.length, req, res);
        } else {
          res.json({ status: "ok", lists: list, totalCount: totalCount });
        }
      });
    } else {
      List.find({users: req.apiAuth.userId }, function(err, lists){
        if (err) {
          return res.json({status: "error", message: "There was an error retrieving the custom contact lists."});
        }
        res.json({ status: "ok", lists: lists });
      });
    }
  });
}

// TODO: Refactor to do this with waterfall.
// Returns query results in PDF format from generated HTML output.
function getReturnPDF(list, req, res) {
  /*if (!req.userCanExport) {
    log.warn({'type': 'contactViewPDF:error', 'message': 'User attempted to fetch the PDF export from a contact list, but is not authorized to do so.'});
    res.send(403, "Access Denied");
    res.end();
    return callback(true);
  }*/

  var listTitle = list.name,
    contacts = list.contacts,
    protectedRolesData = null,
    orgTypesData = null,
    disastersData = null,
    rolesData = null,
    templateData = null;

  async.series([
    function (cb) {
      // Load admin roles data
      roles.get(function (err, roles) {
        rolesData = roles;
        cb();
      });
    },
    function (cb) {
      // Load protected roles data
      protectedRoles.get(function (err, roles) {
        protectedRolesData = roles;
        cb();
      });
    },
    function (cb) {
      // Load organization types data
      orgTypes.get(function (err, orgTypes) {
        orgTypesData = orgTypes;
        cb();
      });
    },
    function (cb) {
      // Load disasters data
      disasters.getAll(function (err, disasters) {
        disastersData = disasters;
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
    _.each(req.query, function (val, key) {
      if (['address.country', 'address.administrative_area', 'address.locality', 'bundle', 'office.name', 'organization.name', 'protectedBundles'].indexOf(key) !== -1) {
        filters.push(req.query[key]);
      }
      else if (key == 'protectedRoles') {
        var prIndex = _.findIndex(protectedRolesData, function (item) {
          return (item.id == val);
        });
        filters.push(protectedRolesData[prIndex].name);
      }
    });
    if (req.query.hasOwnProperty('organization.org_type_remote_id') && req.query['organization.org_type_remote_id']) {
      var orgTypeId = req.query['organization.org_type_remote_id'],
        orgType = _.find(orgTypesData, function (item) {
          return (item.id === orgTypeId);
        });
      if (orgType && orgType.name) {
        filters.push(orgType.name);
      }
    }
    if (req.query.hasOwnProperty('disasters.remote_id') && req.query['disasters.remote_id']) {
      var disasterId = req.query['disasters.remote_id'];
      if (disastersData && disastersData.hasOwnProperty(disasterId) && disastersData[disasterId].name) {
        filters.push(disastersData[disasterId].name);
      }
    }
    if (req.query.hasOwnProperty('role') && req.query.role) {
      var role = _.find(rolesData, function (item) {
        return (item.id === req.query.role);
      });
      if (role && role.name) {
        filters.push(role.name);
      }
    }
    if (req.query.hasOwnProperty('keyContact') && req.query.keyContact) {
      filters.push('Key Contact');
    }
    if (req.query.hasOwnProperty('verified') && req.query.verified) {
      filters.push('Verified User');
    }
    if (req.query.hasOwnProperty('ghost') && req.query.ghost) {
      filters.push('Ghost Users');
    }
    if (req.query.hasOwnProperty('orphan') && req.query.orphan) {
      filters.push('Orphan Users');
    }

    var template = Handlebars.compile(String(templateData)),
      isGlobal = false,
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
          log.info({'type': 'contactViewPDF:success', 'message': 'Successfully generated PDF data for contactView query.'});//, 'query': query, 'range': range});
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
}

// Returns query results in CSV format.
function getReturnCSV(contacts, count, req, res) {
  /*if (!req.userCanExport) {
    //log.warn({'type': 'contactViewPDF:error', 'message': 'User attempted to fetch the PDF export from a contact list, but is not authorized to do so.'});
    res.send(403, "Access Denied");
    res.end();
    return callback(true);
  }*/

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
    log.info({'type': 'contactViewCSV:success', 'message': 'Successfully generated CSV data for contactView query.'});
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
    'URI',
    'Notes'
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
        // Make sure actual value is defined.
        if (typeof fieldEntry[value.key] !== 'undefined') {
          // Type is defined and is one of the predefined accepted values.
          if (typeof fieldEntry.type !== 'undefined' && typeof value.types[fieldEntry.type] !== 'undefined') {
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

    // Tack on a semicolon to the end of all phone number,
    // having them displayed as a string in excel.
    _.forEach(multiValues.phone.types, function(value, type){
      var nums = value.join('; ');
      multiValues.phone.types[type] = nums.length ? nums + ';' : nums;
    });

    stringifier.write([
      item.nameGiven,
      item.nameFamily,
      item.jobtitle,
      item.organization.map(function (val) { if (val && val.name) { return val.name; } }).join('; '),
      item.bundle.join('; '),
      item.address && item.address[0] && item.address[0].country ? item.address[0].country : '',
      item.address && item.address[0] && item.address[0].administrative_area ? item.address[0].administrative_area : '',
      item.address && item.address[0] && item.address[0].locality ? item.address[0].locality : '',
      multiValues.phone.types['Landline'],
      multiValues.phone.types['Mobile'],
      multiValues.phone.types['Fax'],
      multiValues.phone.types['Satellite'],
      multiValues.voip.types['Voip'].join('; '),
      multiValues.email.types['Email'].join('; '),
      multiValues.email.types['Work'].join('; '),
      multiValues.email.types['Personal'].join('; '),
      multiValues.email.types['Other'].join('; '),
      item.uri ? item.uri.join('; '): '',
      item.notes
    ]);
  });

  stringifier.end();
}

exports.get = get;
