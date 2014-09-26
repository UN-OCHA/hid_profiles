# User Profiles API

This is a profile field API that uses [restify](http://mcavage.me/node-restify/) and Mongoose.

## Installation

Run `npm install` to ensure all dependicies are met. Run `node server` to start the server, and the API endpoints will be available at http://localhost:4000

## Examples

### Viewing (searching) profile data

Visit this URL in a browser or via curl to view all documents containing the desired profile fields: http://contactsid.local:4000/v0/profile/view

Use parameters to search profile fields. These parameters are case-insensitive and nothing is required (though, at least one parameter must be given, or the request will be ignored).

  * userid=[String] (required, or email is required)
  * fullname=[String]
  * givenname=[String]
  * familyname=[String]
  * jobtitle=[String]
  * organization=[String]
  * phone=[String]
  * email=[String] (required, or userid is required)

### Saving profile data

Visit this URL in a browser or via Curl to create or update a profile document: http://contactsid.local:4000/v0/profile/save/:uid

Use the following parameters to provide the values for each profile field (all values must be URL encoded):

  * userid=[String] (required)
  * fullname=[String]
  * givenname=[String]
  * familyname=[String]
  * jobtitle=[String]
  * organization=[String]
  * phone=[String]
  * email=[String]

The :uid in the path can be either '0' (to indicate a new profile document) or the _id of the mongo document for that profile (to update an existing document).

Example: curl 'http://contactsid.local:4000/v0/profile/save/5418efc931461315485ed408?fullname=Tobby%20D.%20Hagler&givenname=Tobby&familyname=Hagler&jobtitle=Software%20Architect&organization=Phase2&phone=800-555-1212&email=thagler%40phase2technology.com'

### Listing available profile fields

Visit this URL in a browser to get a JSON list of all available profile fields: http://contactsid.local:4000/v0/profile/model

