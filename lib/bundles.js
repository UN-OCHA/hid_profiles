var _ = require('lodash'),
  log = require('../log'),
  restify = require('restify'),
  config = require('../config');


// Fetch all bundles from the HumanitarianResponse API and prepare the data to
// be collated with operation data in operations.buildAppData().
//
// Example API query for bundles:
// http://www.humanitarianresponse.info/api/v1.0/bundles?page=13
function fetchBundles(callback) {
  var client = restify.createJsonClient({
    url: config.hrinfoBaseUrl
  }),
  bundles = {},
  bundle,
  page = 1;

  // Fetch a set of bundles, and allow recursion to get additional results.
  function fetchBundleSet() {
    client.get('/api/v1.0/bundles?page=' + page,
      function(err, req, res, obj) {
        if (err) {
          return callback(err);
        }

        // Parse and combine data
        if (obj.data && obj.data.length) {
          _.forEach(obj.data, function (item) {
            if (!item.id || !item.label || !item.operation || !item.operation[0]) {
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
          fetchBundleSet();
        }
        else {
          callback(null, bundles);
        }
      });
  }

  // Fetch the first set
  fetchBundleSet();
}


// Expose module functions
exports.fetchBundles = fetchBundles;
