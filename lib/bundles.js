var _ = require('lodash'),
  log = require('../log'),
  restify = require('restify');


// Fetch all bundles from the HumanitarianResponse API and prepare the data to
// be collated with operation data in operations.buildAppData().
//
// Example API query for bundles:
// http://www.humanitarianresponse.info/api/v1.0/bundles?page=13
function fetchBundles(callback) {
  var client = restify.createJsonClient({
    url: process.env.HRINFO_BASE_URL 
  }),
  bundles = {},
  bundle,
  page = 1;

  // Fetch a set of bundles, and allow recursion to get additional results.
  function fetchBundleSet() {
    console.log("INFO: Fetching bundles data page " + page);
    client.get('/api/v1.0/bundles?page=' + page,
      function(err, req, res, obj) {
        client.close();

        if (err) {
          console.log("ERROR: Error when fetching bundles.", err);
          return callback(err);
        }

        // Parse and combine data
        if (obj.data && obj.data.length) {
          _.forEach(obj.data, function (item) {
            if (!item.id || !item.label || !item.operation || !item.operation[0]) {
              console.log("INFO: Invalid bundle data: " + JSON.stringify(item));
              return;
            }
            bundle = {
              remote_id: 'hrinfo:' + item.id,
              name: item.label,
              hid_access: item.hid_access,
              operation_id: 'hrinfo:' + item.operation[0].id
            };
            bundles[bundle.remote_id] = bundle;
          });
        }

        // Check for additional results
        if (obj.next && obj.next.href && obj.next.href.length) {
          page++;
          setTimeout(fetchBundleSet, 500);
        }
        else {
          console.log("SUCCESS: Retrieved bundles data.");
          callback(null, bundles);
        }
      });
  }

  // Fetch the first set
  fetchBundleSet();
}


// Expose module functions
exports.fetchBundles = fetchBundles;
