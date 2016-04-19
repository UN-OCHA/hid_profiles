var Contact = require('../models').Contact,
  Profile = require('../models').Profile,
  Cache = require('../models').Cache,
  log = require('../log'),
  roles = require('../lib/roles'),
  orgTypes = require('../lib/orgTypes'),
  protectedRoles = require('../lib/protectedRoles'),
  disasters = require('../lib/disasters'),
  stringify = require('csv-stringify'),
  _ = require('lodash'),
  async = require('async'),
  fs = require('fs'),
  Handlebars = require('handlebars'),
  restify = require('restify'),
  moment = require('moment'),
  qs = require('querystring'),
  http = require('http'),
  intl = require('intl'),
  operations = require('../lib/operations');

function get(req, res) {
  // Initialize variables for get() scope.
  var lockedOperations = [],
    query = {},
    range = {skip: 0, limit: 0},
    contactList = [];

  // Initialize permissions and profile ID
  req.userCanViewAllContacts = false;
  req.userCanExport = false;
  req.userProfileId = null;

  // Determines user privileges for get operation.
  function access(callback) {
    // Trusted API clients are allowed read access to all contacts.
    if (req.apiAuth.mode === 'client' && req.apiAuth.trustedClient) {
      req.userCanExport = true;
      req.userCanViewAllContacts = true;
      return callback(null);
    }
    // For users, we need to check their profile.
    else if (req.apiAuth.mode === 'user' && req.apiAuth.userId) {
      Profile.findOne({userid: req.apiAuth.userId}, function (err, profile) {
        if (!err && profile && profile._id) {
          // All users can export data.
          req.userCanExport = true;

          // Set the profile ID for this user for use in a query later.
          req.userProfileId = profile._id;
          // Verified users can view all contacts.
          if (profile.verified) {
            req.userCanViewAllContacts = true;
          }
          return callback(null);
        }
        else {
          return callback(err);
        }
      });
    }
  }

  // Fetches data necessary for preparing the contacts view query.
  function preFetch(callback) {
    if (req.query.contactList && req.apiAuth.userId) {
      // Look up list of contacts ids for contact list.
      Profile.findOne({userid: req.apiAuth.userId}, function (err, profile) {
        if (profile.contactLists) {
          contactList = _.filter(profile.contactLists, function (n) { return n.name === req.query.locationId; });
        }
        return callback();
      });
    }
    else {
      if (req.userCanViewAllContacts) {
        return callback();
      }
      operations.getLockedOperations(function (err, _lockedOperations) {
        lockedOperations = _lockedOperations;
        callback();
      });
    }
  }

  // Performs query to fetch contacts that match the query parameters.
  function fetch(callback) {
    var docs = {},
      contactSchema = Contact.schema.paths,
      skipCount = 0,
      queryContacts;

    // Prep or statment with ids from personal contact list.
    if (req.query.contactList) {
      queryContacts = {'$or': [{'type': 'none'}]};
      if (contactList[0] && contactList[0].contacts) {
        _.forEach(contactList[0].contacts, function(contId){
          queryContacts['$or'].push({'_id': String(contId)});
        });
      }
      // No longer wanted in query.
      delete req.query.contactList;
      delete req.query.locationId;
    }

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
            {protectedBundles: exp},
            {'disasters.name': exp},
            {'email.address': exp},
            {jobtitle: exp},
            {nameGiven: exp},
            {nameFamily: exp},
            {notes: exp},
            {'office.name': exp},
            {'organization.name': exp},
            {'organization.org_type_name': exp},
            {'phone.number': exp},
            {protectedRoles: exp},
            {uri: exp},
            {'voip.number': exp}
          ];
        }
        else if (recursiveSchemaCheck(contactSchema, prop.split('.'))) {
          query[prop] = val;
        }
      }
    }

    // Add locked operation exclusions
    if (lockedOperations.length) {
      var queryLock = {
        '$or': [
          {'locationId': {'$nin': lockedOperations}},
          {'_profile': req.userProfileId || null}
        ]
      };
      if (query.hasOwnProperty('$or')) {
        query['$and'] = [
          {'$or': query['$or']},
          {'$or': queryLock['$or']}
        ];
      }
      else {
        query['$or'] = queryLock['$or'];
      }
    }

    // Add contact list ids.
    if (queryContacts) {
      if (query.hasOwnProperty('$or')) {
        query['$and'] = [
          {'$or': query['$or']},
          {'$or': queryContacts['$or']}
        ];
      }
      else {
        query['$or'] = queryContacts['$or'];
      }
    }

    // Skip the count query and disable skip and limit values if the query
    // requires filtering after execution (includes filters for verified,
    // role, ghost, or orphan).
    if (req.query.hasOwnProperty("verified") || req.query.hasOwnProperty("role") || req.query.hasOwnProperty("ghost") || req.query.hasOwnProperty("orphan")) {
      skipCount = 1;
      range.skip = 0;
      range.limit = 0;
    }

    var result = {},
      contacts = [],
      count = 0;

    async.series([
      function (cb) {
        // Perform a count query to determine total number of matching contacts.
        if (!skipCount) {
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
              return cb();
            });
        }
        else {
          return cb();
        }
      },
      function (cb) {
        var sort = {};
        var sortskip = range.skip;
        var sortlimit = range.limit;
        if (!req.query.sort) {
          sort = {nameGiven: 1, nameFamily: 1};
        }
        else {
          if (req.query.sort == 'name') {
            sort = {nameGiven: 1, nameFamily: 1};
          }
          if (req.query.sort == 'jobtitle') {
            sort = {jobtitle: 1};
          }
          if (req.query.sort != 'jobtitle' && req.query.sort != 'name') {
            sort = {nameGiven: 1, nameFamily: 1};
          }
          if (req.query.sort == 'organization' || req.query.sort == 'verified') {
            range.skip = 0;
            range.limit = 5000;
          }
        }

        // Perform query with populate to include associated profile documents.
        Contact
          .find(query)
          .skip(range.skip)
          .limit(range.limit)
          .sort(sort)
          .populate('_profile')
          .exec(function (err, _contacts) {
            if (err) {
              log.warn({'type': 'contactView:error', 'message': 'Error occurred while performing query for contacts.', 'err': err});
              result = {status: "error", message: "Query failed for contacts."};
              res.send(result);
              return callback(err);
            }
            else {
              if (_contacts && _contacts.length) {
                contacts = _contacts;

                if (req.query.hasOwnProperty("verified") && req.query.verified) {
                  contacts = contacts.filter(function (item) {
                    return item._profile && item._profile.verified;
                  });
                }

                if (req.query.hasOwnProperty("role") && req.query.role.length) {
                  contacts = contacts.filter(function (item) {
                    return item._profile && item._profile.roles && item._profile.roles.indexOf(req.query.role) >= 0;
                  });
                }

                if (req.query.hasOwnProperty("ghost") && req.query.ghost) {
                  contacts = contacts.filter(function (item) {
                    return item._profile && item._profile.userid && !item._profile.userid.match(/^.+@.+_\d+$/);
                  });
                }

                if (req.query.hasOwnProperty("orphan") && req.query.orphan) {
                  contacts = contacts.filter(function (item) {
                    var profile = item._profile ? item._profile.toObject() : false;
                    return profile && profile.userid && profile.userid.match(/^.+@.+_\d+$/) && (!profile.hasOwnProperty('firstUpdate') || !profile.firstUpdate);
                  });
                }

                if (skipCount) {
                  count = contacts.length;
                }

                if (req.query.sort == 'verified') {
                  contacts = contacts.sort(function (a, b) {
                    var aprofile = a._profile ? a._profile.toObject() : false;
                    var bprofile = b._profile ? b._profile.toObject() : false;
                    var aname = a.fullName();
                    var bname = b.fullName();
                    if (aprofile && aprofile.verified) {
                      if (bprofile && bprofile.verified) {
                        if (aname > bname) {
                          return 1;
                        }
                        else if (aname < bname) {
                          return -1;
                        }
                        return 0;
                      }
                      else {
                        return -1;
                      }
                    }
                    if (bprofile && bprofile.verified) {
                      return 1;
                    }
                    if (aname > bname) {
                      return 1;
                    }
                    else if (aname < bname) {
                      return -1;
                    }
                    return 0;
                  });
                  contacts = contacts.slice(sortskip, sortskip + sortlimit);
                }

               if (req.query.sort == 'organization') {
                 contacts = contacts.sort(function (a, b) {
                   var aname = a.fullName().toUpperCase();
                   var bname = b.fullName().toUpperCase();
                   var aorg = a.mainOrganization();
                   var borg = b.mainOrganization();
                   var aorgname = '';
                   var borgname = '';
                   if (aorg && aorg.name) {
                     aorgname = aorg.name;
                   }
                   if (borg && borg.name) {
                     borgname = borg.name;
                   }
                   aorgname = aorgname.toUpperCase();
                   borgname = borgname.toUpperCase();
                   var out = aorgname.localeCompare(borgname);
                   if (out == 0) {
                     out = aname.localeCompare(bname);
                   }
                   return out;
                 });
                 contacts = contacts.slice(sortskip, sortskip + sortlimit);
               }
              }
              var result = {
                contacts: contacts,
                count: count
              };
              return cb(null, result);
            }
          });
    }], function (err, result) {
      return callback(err, result[1].contacts, result[1].count);
    });
  }

  // Recursively check schema for properties in array.
  function recursiveSchemaCheck(schema, propArray) {
    var prop = propArray.shift();
    if (schema.hasOwnProperty(prop)) {
      if (propArray.length  && schema[prop].hasOwnProperty('schema')) {
        return recursiveSchemaCheck(schema[prop].schema.paths, propArray);
      }
      else {
        return true;
      }
    }
    else {
      return false;
    }
  }

  // Returns query results in JSON format.
  function getReturnJSON(contacts, count, callback) {
    var result = {status: "ok", contacts: contacts, count: count};
    log.info({'type': 'contactView:success', 'message': 'Successfully returned data for contactView query.', 'query': query, 'range': range});
    res.send(result);
    callback();
  }

  // Returns query results in JSON format of email data.
  function getReturnEmailsJSON(contacts, count, callback) {
    var emailContacts, result;

    emailContacts = [];
    _.forEach(contacts, function(cont){
      if (cont.email && cont.email[0] && cont.email[0].address) {
        emailContacts.push({
          email: cont.email[0].address,
          name: cont.nameGiven + " " + cont.nameFamily
        });
      }
    });

    result = {status: "ok", contacts: emailContacts, count: emailContacts.length};
    log.info({'type': 'contactView:success', 'message': 'Successfully returned email data for contactView query.', 'query': query, 'range': range});
    res.send(result);
    callback();
  }

  // Returns query results in CSV format.
  function getReturnCSV(contacts, count, callback) {
    if (!req.userCanExport) {
      log.warn({'type': 'contactViewPDF:error', 'message': 'User attempted to fetch the PDF export from a contact list, but is not authorized to do so.'});
      res.send(403, "Access Denied");
      res.end();
      return callback(true);
    }

    var csvData = '',
      roles = {},
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
      'Roles',
      'Country',
      'Admin Area',
      'Locality',
      'Offices',
      'Phone:Landline',
      'Phone:Mobile',
      'Phone:Fax',
      'Phone:Satellite',
      'VOIP',
      'Email',
      'Email:Work',
      'Email:Personal',
      'Email:Other',
      'Departure Date',
      'URI',
      'Notes'
    ]);

    async.series([
      function (cb) {
        // Load protected roles data
        protectedRoles.get(function (err, data) {
          data.forEach(function(val) {
            roles[val.id] = val.name;
          });
          cb();
        });
      },
      function (cb) {
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
            },
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

        var dateOptions = { day: "numeric", month: "long", year: "numeric" };

        stringifier.write([
          item.nameGiven,
          item.nameFamily,
          item.jobtitle,
          item.organization.map(function (val) { if (val && val.name) { return val.name; } }).join('; '),
          item.bundle.join('; '),
          item.protectedRoles.map(function (id) { return roles[id]; }).join('; '),
          item.address && item.address[0] && item.address[0].country ? item.address[0].country : '',
          item.address && item.address[0] && item.address[0].administrative_area ? item.address[0].administrative_area : '',
          item.address && item.address[0] && item.address[0].locality ? item.address[0].locality : '',
          item.office.map(function (val) { if (val && val.name) { return val.name; } }).join('; '),
          multiValues.phone.types['Landline'],
          multiValues.phone.types['Mobile'],
          multiValues.phone.types['Fax'],
          multiValues.phone.types['Satellite'],
          multiValues.voip.types['Voip'].join('; '),
          multiValues.email.types['Email'].join('; '),
          multiValues.email.types['Work'].join('; '),
          multiValues.email.types['Personal'].join('; '),
          multiValues.email.types['Other'].join('; '),
          item.departureDate ? item.departureDate.toLocaleDateString('en', dateOptions) : '',
          item.uri ? item.uri.join('; '): '',
          item.notes
        ]);
      });

      stringifier.end();
      cb();
    }]);
  }

  // Returns query results in PDF format from generated HTML output.
  function getReturnPDF(contacts, count, meeting, callback) {
    if (!req.userCanExport) {
      log.warn({'type': 'contactViewPDF:error', 'message': 'User attempted to fetch the PDF export from a contact list, but is not authorized to do so.'});
      res.send(403, "Access Denied");
      res.end();
      return callback(true);
    }

    var listTitle = '',
      protectedRolesData = null,
      orgTypesData = null,
      disastersData = null,
      rolesData = null,
      templateData = null;

    async.series([
      function (cb) {
        if (query.type !== 'global' && query.locationId && query.locationId !== 'global') {
          operations.get(query.locationId, function (err, operation) {
            if (operation && operation.name && operation.name.length) {
              listTitle = operation.name;
            }
            return cb();
          });
        }
        else {
          listTitle = 'Global Contact List';
          return cb();
        }
      },
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
        var template = 'views/printList.html';
        if (meeting) {
          template = 'views/' + meeting + '.html';
        }
        fs.readFile(template, function (err, data) {
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
        if (['address.country', 'address.administrative_area', 'address.locality', 'bundle', 'office.name', 'organization.name', 'protectedBundles'].indexOf(key) !== -1) {
          filters.push(query[key]);
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
      if (req.query.hasOwnProperty('localContacts') && req.query.localContacts && req.query.localContacts !== 'false') {
        if (req.query.hasOwnProperty('globalContacts') && req.query.globalContacts && req.query.globalContacts !== 'false') {
          filters.push('Global & Local Contacts');
        }
        else {
          filters.push('Only Local Contacts');
        }
      }
      if (req.query.hasOwnProperty('ghost') && req.query.ghost) {
        filters.push('Ghost Users');
      }
      if (req.query.hasOwnProperty('orphan') && req.query.orphan) {
        filters.push('Orphan Users');
      }

      var emptyLines = [];
      for (var i = 0; i < 12; i++) {
        emptyLines.push(i);
      }

      // Use organization acronym whenever possible
      var regExp = /\(([^)]+)\)/;
      var matches = [];
      _.each(contacts, function (contact) {
        contact.org_name = '';
        if (contact.organization[0] && contact.organization[0].name) {
          contact.org_name = contact.organization[0].name;
          matches = regExp.exec(contact.org_name);
          if (matches && matches.length && matches[1]) {
            contact.org_name = matches[1];
          }
        }
      });

      var template = Handlebars.compile(String(templateData)),
        isGlobal = (query.type === 'global' || !query.locationId || !query.locationId.length),
        tokens = {
          appBaseUrl: process.env.APP_BASE_URL,
          listTitle: listTitle,
          isGlobal: isGlobal,
          queryCount: contacts.length,
          filters: filters,
          dateGenerated: moment().format('LL'),
          contacts: contacts,
          emptyLines: emptyLines
        },
        result = template(tokens),
        postData = qs.stringify({
          'html' : result
        }),
        options = {
          hostname: process.env.WKHTMLTOPDF_HOST,
          port: process.env.WKHTMLTOPDF_PORT || 80,
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

  function getReturnMeetingComfortablePDF(contacts, count, callback) {
    return getReturnPDF(contacts, count, 'printMeetingComfortable', callback);
  }

  function getReturnMeetingCompactPDF(contacts, count, callback) {
    return getReturnPDF(contacts, count, 'printMeetingCompact', callback);
  }

  function getReturnNormalPDF(contacts, count, callback) {
    return getReturnPDF(contacts, count, false, callback);
  }

  // Define workflow.
  var steps = [
    access,
    preFetch,
    fetch
  ];
  if (req.query.export && req.query.export === 'pdf') {
    steps.push(getReturnNormalPDF);
  }
  else if (req.query.export && req.query.export === 'meeting-comfortable') {
    steps.push(getReturnMeetingComfortablePDF);
  }
  else if (req.query.export && req.query.export === 'meeting-compact') {
    steps.push(getReturnMeetingCompactPDF);
  }
  else if (req.query.export && req.query.export === 'csv') {
    steps.push(getReturnCSV);
  }
  else if (req.query.export && req.query.export === 'email') {
    steps.push(getReturnEmailsJSON);
  }
  else {
    steps.push(getReturnJSON);
  }

  // Execute workflow with async pattern.
  async.waterfall(steps);
}

// Get a contact by id
function getById(req, res, next) {
  Contact
    .findById(req.params.id)
    .populate('_profile')
    .exec(function(err, contact) {
    if (err) {
      res.send(500, new Error(err));
      return next();
    }
    if (contact) {
      // Make sure I have permission to view contact
      if (contact.type === 'local' && !req.apiAuth.userProfile.verified) {
        // Get locked operations
        operations.getLockedOperations(function (err, lockedOperations) {
          if (err) {
            res.send(500, new Error(err));
            return next();
          }
          if (lockedOperations.indexOf(contact.locationId) !== -1) {
            res.send(403, new Error("You do not have permission to view this contact"));
            return next();
          }
          res.send(200, contact);
          return next();
        });
      }
      else {
        res.send(200, contact);
        return next();
      }
    }
    else {
      res.send(404, new Error("Contact " + req.params.id + " not found"));
      return next();
    }
  });
}

exports.get = get;
exports.getById = getById;
