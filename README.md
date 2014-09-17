# User Profiles API

This is a small example that uses [restify](http://mcavage.me/node-restify/) and Mongoose.

## Installation

Run `npm install` to ensure all dependicies are met. Run `node server` to start the server, and the API endpoints will be available at http://localhost:8080

## Examples

Visit this URL in a browser or via Curl to create or update a profile document: http://contactsid.local:8080/v0/profile/save/:uid

Use the following parameters to provide the values for each profile field (all values must be URL encoded):

  * fullname=[String]
  * givenname=[String]
  * familyname=[String]
  * jobtitle=[String]
  * organization=[String]
  * phone=[String]
  * email=[String]

The :uid in the path can be either '0' (to indicate a new profile document) or the _id of the mongo document for that profile (to update an existing document).

Example: curl 'http://contactsid.local:8080/v0/profile/save/5418efc931461315485ed408?fullname=Tobby%20D.%20Hagler&givenname=Tobby&familyname=Hagler&jobtitle=Software%20Architect&organization=Phase2&phone=800-555-1212&email=thagler%40phase2technology.com'