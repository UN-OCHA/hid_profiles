var _ = require('lodash'),
  log = require('../log'),
  restify = require('restify');


// Fetch all coordination offices from the HumanitarianResponse API and prepare the data to
// be collated with operation data in operations.buildAppData().
//
// Example API query for offices:
// http://www.humanitarianresponse.info/api/v1.0/offices?page=13
function fetchOffices(callback) {
  var client = restify.createJsonClient({
    url: process.env.HRINFO_BASE_URL
  }),
  offices = {},
  office,
  page = 1;

  // Fetch a set of offices, and allow recursion to get additional results.
  function fetchOfficeSet() {
    console.log("INFO: Fetching offices data page " + page);
    client.get('/api/v1.0/offices?page=' + page,
      function(err, req, res, obj) {
        client.close();

        if (err) {
          console.log("ERROR: Error when fetching offices.", err);
          return callback(err);
        }

        // Parse and combine data
        if (obj.data && obj.data.length) {
          _.forEach(obj.data, function (item) {
            if (!item.id || !item.label || !item.operation || !item.operation[0]) {
              console.log("INFO: Invalid office data: " + JSON.stringify(item));
              return;
            }
            office = {
              remote_id: 'hrinfo_off_' + item.id,
              name: item.label,
              hid_access: item.hid_access,
              operation_id: 'hrinfo:' + item.operation[0].id
            };
            offices[office.remote_id] = office;
          });
        }

        // Check for additional results
        if (obj.next && obj.next.href && obj.next.href.length) {
          page++;
          setTimeout(fetchOfficeSet, 500);
        }
        else {
          console.log("SUCCESS: Retrieved offices data.");
          callback(null, offices);
        }
      });
  }

  // Fetch the first set
  fetchOfficeSet();
}


// Expose module functions
exports.fetchOffices = fetchOffices;
