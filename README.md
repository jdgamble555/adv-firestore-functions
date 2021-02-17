# Advanced Firestore Functions

These are the back-end firestore functions that will allow you to create easy-to-use indexes. 

**Installation**

Install the package into your **firebase functions** directory.

```npm i adv-firestore-functions```

Import the necessary functions at the top of your firebase function file:

```typescript
import { eventExists, fullTextIndex } from 'adv-firestore-functions';
```

All of these functions are called on an **async onWrite** firebase firestore function like so:

```typescript
functions.firestore
    .document('posts/{docId}')
    .onWrite(async (change: any, context: any) => {
//... code
}
```

The search functions, however, must be put in a callable function like so:

```typescript
functions.https.onCall(async (q: any) => {

// 'q' is the data coming in

//... code
}
```

# Searching

**Relevant Search Index** - New!

This function will allow you to create a relevant search index.

```typescript
await relevantIndex(change, context, {
   fields: ['content', 'summary']
});
```
Simply pass the fields you want to index. Events, indexing, deleting... everything is done internally! It only creates one document per document to index. 

By default, all fields are indexed, but you could index them seperately with `combine=true` paramenter.

You can also import your own custom filter function like so:

```typescript
import { soundex } from 'adv-firestore-functions';

await relevantIndex(change, context, {
    fields: ['content', 'summary'],
    filterFunc: soundex
});
```

This will filter the data through a soundex [phonetic algorithm](https://en.wikipedia.org/wiki/Phonetic_algorithm). The version included in this package only works with English, but you can use your own function here to work with any language.

Soundex works well when you search for something you don't know how to spell. Trigrams are better for any typos. However, depending on your needs, this is much much faster.

```typescript
/**
 * indexes a collection by relevance
 * @param change
 * @param context
 * @param _opts: {
 *   fields - array of fields to index
 *   searchCol - name of search collection, default _search
 *   numWords - number of words to index at a time, default 6
 *   combine - whether or not to combine fields in one collection, default true
 *   allCol - name of all fields collection, default _all
 *   termField - name of terms array, default _term
 *   filterFunc - function to filter, can pass a soundex function
 * }
 */
```

**Relevant Search Callable**

Run this in the callable function:

```typescript
  return await relevantSearch({
    query: q.query,
    col: 'posts',
  });
```

You can set the options you want to be called. If you indexed all columns and you are searching all columns, you can use paging by a `startId`.

```typescript
/**
 * Relevant search callable function
 * @param _opts {
 *   query - query to search
 *   col - collection to search
 *   fields - fields to search
 *   searchCol - name of search collection, default _search
 *   termField - name of term field to search, default _term
 *   filterFunc - name of function to filter
 *   limit - number of search results to limit, default 10
 *   startId - id field for paging, only works with _all index
 * }
 * @returns - will return a sorted array of docs with {id, relevance}
 *   the higher the relevance, the better match it is...
 */
```

**Trigram Search Index** - New!

This function will allow you to create a trigram search index.

```typescript
await trigramIndex(change, context, {
   fields: ['content', 'summary']
});
```
Simply pass the fields you want to index. Events, indexing, deleting... everything is done internally! It only creates one document per document to index. 

```typescript
/**
 * Generates an index for trigrams on a document
 * @param change
 * @param context
 * @param _opts {
 *   fields - array of fields to index
 *   trigramCol - name of trigram colleciton, default _trigrams
 *   combine - whether or not to combine fields in one collection, default true
 *   combinedCol - name of combined collection, default _all
 *   termField - name of field to store trigrams, default _term
 * }
 */
```
**Trigram Search Callable**

Run this in the callable function:

```typescript
  return await trigramSearch({
    query: q.query,
    col: 'posts',
  });
```

This function can be cumbersome on the backend. Depending on your setup, it may be quicker to translate the promises to observables and keep it on the front end.

```typescript
/**
 * Trigram Search callable function
 * @param _opts {
 *   query - query to search
 *   col - collection to search
 *   fields - fields to search, defaults to _all if indexed
 *   searchCol - name of search collection, default _search
 *   termField - name of term field to search, default _term
 *   limit - number of search results to limit, default 10
 * }
 * @retuns - will return a sorted array of docs with {id, relevance}
 *   the higher the relevance, the better match it is...
 */
```

**Full-text search**

*Note:* - This function is depreciated as of version 2.0.0, use relevant search or trigram search instead!

*WARNING!* - This function can create A LOT of documents if you have a big text field. However, it is worth it if you only **write** sporatically.

This will index your fields so that you can search them. No more Algolia or Elastic Search! It will create documents based on the number of words in the field. So a blog post with 100 words, will create 100 documents indexing 6 words at a time. You can change this number. Since you generally write / update fields in firebase rarely, 100 documents is not a big deal to index, and will save you money on searching. The size of the document is just 6 words, plus the other foreign key fields you want to index. This function will automatically create, delete, and update the indexes when necessary.  All of these functions use transactions, batching, and chunking (100 documents at a time) to provide the best performance.

**Events**

**Note** - As of 2.0.0, events are now handled internally, but you can call the function if you have have custom code...

Anytime you use a counter function, or a complicated function like **fullTextIndex** that you only want run once, make sure to add the event function at the top of your code. Firebase functions can run functions more than once, messing up your indexes and counters.

```typescript
// don't run if repeated function
if (await eventExists(context)) {
    return null;
}
```

```typescript
/**
 * Runs a set function once using events
 * @param context - event context
 * @param eventsCol - defaults to '_events'
 * @returns - true if first run
 */
```

So, in order to index the title and the content of your **posts** function, you could have something like this:
```typescript
// index the posts
const searchable = ['content', 'title'];
searchable.forEach(async (field: string) => {
    await fullTextIndex(change, context, field);
});
```

--options--

```typescript
await fullTextIndex(change, context, 'field-to-index', ['foreign', 'keys', 'to', 'index']);
```
The foreign keys to index will be all of the fields you will get back in a search. It defaults to ONLY the **document id**, however, you can add or change this to whatever fields you like.

```typescript
await fullTextIndex(change, context, field, foreign-keys, type);
```
The **type** input defaults to 'id', and is indexed on all options.   
--id - just makes the document searchable from the **id** field using the *~* trick on the 6 word chunk you are searching.  
--map - makes the document searchable using a **map** of **_terms** (same as document id)  
--array - makes the document searchable using an **array** of **_terms** (same as document id)  

```typescript
// map
{
    _terms: {
        a: true,
        al: true,
        also: true,
        also : true,
        also t: true
        ...
    }
}
// array
{
    _terms: [
        a,
        al,
        als,
        also,
        also ,
        also t,
        ...
    ]
}
```

**Maps** and **Arrays** are useful when you want to do complex searching, depending on what your constraints are. They do require more space on your documents and database size, but do not create any additional documents. Obviously searching is still limited to firestore's limits.

```typescript
/**
 * Full Text Search
 * @param change - functions change interface
 * @param context - event context
 * @param field - the field to index
 * @param fk - the foreign key fields to get
 * @param type - { id, map, array } - defaults to id
 * @param n - number of word chunks to index at a time
 * @param searchCol - name of search collection
 */
 ```

*Front-end:* This will depend on your implementation, but generally, you will use something like the following code:

```typescript
let id = firebase.firestore.FieldPath.documentId();
const col = `_search/COLLECTION_NAME/COLLECTION_FIELD`;

db.collection(col).orderBy(id).startAt(term).endAt(term + '~').limit(5);
```
On the front-end you could theoretically combine searches for searching several collections at once, separate queries by commas or spaces, or even group documents by relevance by the number of times the documents with the same foreign key id (your source document) appear. However, I would suggest indexing using **maps** or **arrays** for some more advanced features.

If you are in fact using **map** or **array**, you may have something like this:

```typescript
const col = `_search/COLLECTION_NAME/COLLECTION_FIELD`;

db.collection(col).where('_terms.' + term, '==', true); // map
db.collection(col).where('_terms', 'array-contains', term); // array
```

**Index unique fields**

Unique fields is pretty simple, add the unique field function and it will update automatically everytime there is a change. Here you can index the unique 'title' field. Check code for options like **friendlyURL**.

```typescript
await uniqueField(change, context, 'title');
```

```typescript
/**
 * Handle all unique instances
 * @param change - change snapshot
 * @param context - event context
 * @param field - feild to index
 * @param friendly - boolean: save friendly string
 * @param newField - the value of the field if you want to filter it
 * @param fkName - name of foreign key field
 * @param uniqueCol - name of unique collection
 */
```

*Front-end:* Again, this will depend, but generally speaking you search like so:

```typescript
db.doc(`_uniques/COLLECTION_NAME/${title}`);
```
on the document name to see if the 'title', in this case, is a unique value. Just use **snapshot.exists** depending on your front-end code.

*Note: The following indexes care created automatically if they do not exist.*

**Collection counters**

This will create a counter every time the collection is changed. 

```typescript
await colCounter(change, context);
```

You can find any collection counter that you index here:

```typescript
// count = n
db.doc(`_counters/COLLECTION_NAME`);
```

```typescript
/**
 * Runs the counter function
 * @param change - change ref
 * @param context - event context
 */
```

**Condition counters**

This will allow you to count changes in a condition. 

Let's say you want to count **isNice** being **true** on a **posts** doc.

You would run this in the **onWrite** function of a **posts** doc.

```typescript
await conditionCounter(change, context, 'isNice', '==', true);
```

This will count automatically update the **isNiceCount**, or "isNice == true" on the "_counters/posts" doc.

Possible where operators [here](https://firebase.google.com/docs/reference/node/firebase.firestore#wherefilterop)
(no support for: array-contains, in, array-contains-any, or not-in)
Post an issue if you need this [here](https://github.com/jdgamble555/adv-firestore-functions/issues)

```typescript
/**
 * Adds a condition counter to a doc
 * @param change - change ref
 * @param context - event context
 * @param field - where field path
 * @param operator - where operator
 * @param value - where value
 * @param countName - counter field name, default ${field}Count
 * @param countersCol - counter collection name, default _counters
 * @param del - boolean, delete counter document if 0 ?
 * @returns
 */
```

**Query counters**

Query counters are very interesting, and will save you a lot of time.  For example, you can count the number of documents a user has, or the number of categories a post has, and save it on the original document.

(See below for the *getValue* function)

```typescript
// postsCount on usersDoc
import { eventExists, queryCounter, getValue } from 'adv-firestore-functions';

const userId = getValue(change, 'userId');
const userRef = db.doc(`users/${userId}`);
const postsQuery = db.collection('posts').where('userDoc', "==", userRef);

await queryCounter(change, context, postsQuery, userRef);
```

You would get the counter from your target document. In this case it will automatically create **postsCount** on the **users** document.

```typescript
/**
 * Adds a counter to a doc
 * @param change - change ref
 * @param context - event context
 * @param queryRef - the query ref to count
 * @param countRef - the counter document ref
 * @param countName - the name of the counter on the counter document
 * @param del - whether or not to delete the document
 * @param n - 1 for create, -1 for delete
 * @param check - whether or not to check for create or delete doc
 */
```

**Trigger Functions** and **createdAt** / **updatedAt**

You can change the trigger functions to update the same document with a filtered or new value.  For example, if you have a value that you want to create on a function, and then go back and update it (a friendly title in lowercase).

```typescript
// define data
const data: any = {};
data[someValue] = 'some new field value';

// run trigger
await triggerFunction(change, data);
```

ALWAYS HAVE ONLY 1 TRIGGER FUNCTION.  You only need one.

```typescript
/**
 * trigger Function to update dates and filtered values
 * @param change - change event
 * @param data - data to update
 * @param updateDates - use createdAt and updatedAt
 */
```

This will also automatically update **createdAt** and **updatedAt** dates in your document. This is good if you don't want the user to be able to hack these dates on the front end.  You can turn this off by passing in **false** as the last paramenter.

Note: *If you only want to update the dates **createdAt** and **updatedAt**, simply leave out the data parameter.*

However, you need to add **isTriggerFunction** to the top of your code to prevent infinite loops:

```typescript
// don't run if repeated function
if (isTriggerFunction(change, context)) {
    return null;
}
```

There are many options for these as well, see actual code for changing default parameters.

The default counter variable can be changed on all documents. See the code for each function.  You can also change the name of the index collections.  The defaults are *_tags, _search, _uniques, _counters, _categories, _events*.

```typescript
/**
 * Check for trigger function
 * @param change - change ref
 * @param context - event context
 */
```

**Join Functions**

There are several join functions for different use to save you money from foreign key reads on the front end.

**Aggregate Data**

Here you can agregate data, for example the comments on a posts document. You can aggregate any document. The default number of documents added is *3*, but you can change this. You can also add any other fields to the document you want using the *data* field. This will automatically only update when the field has been changed. This will save you money on reads.

This would be called on a *comments* **onWrite** call.

```typescript
import { aggregateData } from 'adv-firestore-functions';

const postId = context.params.postId;
const docRef = admin.firestore().collection('posts').doc(postId);

const queryRef = db.collection('comments').orderBy('createdAt', 'desc');
const exemptFields = ['category'];

await aggregateData(change, context, docRef, queryRef, exemptFields);
```

To change the number of documents to aggregate (5) and the name of the field:

```typescript
import { aggregateData } from 'adv-firestore-functions';

aggregateData(change, context, docRef, queryRef, exemptFields, 'recentComments', 5);
```

```typescript
/**
 * Aggregate data
 * @param change - change functions snapshot
 * @param context - event context
 * @param targetRef - document reference to edit
 * @param queryRef - query reference to aggregate on doc
 * @param fieldExceptions - the fields not to include
 * @param aggregateField - the name of the aggregated field
 * @param n - the number of documents to aggregate, default 3
 * @param data - if adding any other data to the document
 * @param alwaysAggregate - skip redundant aggregation, useful if not date sort
 */
```

**createJoinData**

In order to deal with foreign keys, you first need to add the data when a document is created. This will of course get the latest data.

So, for adding user data to a posts document, for example, you can add it like so on an **onWrite** call on a **posts** document:

```typescript
import { getValue, getJoinData } from 'adv-firestore-functions';

const joinFields = ['displayName', 'photoURL'];
const userId = getValue(change, 'userId');
const userRef = db.collection(`users/${userId}`);

await createJoinData(change, userRef, joinFields, 'user');
```

```typescript
/**
 * Create data to join on document
 * @param change - change event
 * @param targetRef - the target document
 * @param fields - the fields to get from the target document
 * @param field - the field to store the target document fields
 * @param data - data object to update
 * @param alwaysCreate - create even if not necessary
 */
```

**updateJoinData**

You also have to deal with updating the data. For example, this will automatically update user data on a posts document when the user data is changed. This function would need to be called on an **onWrite** call on a **user** document:

```typescript
import { updateJoinData } from 'adv-firestore-functions';

const docId = context.params.docId;
const queryRef = db.collection('posts').where('userId', '==', docId)
const joinFields = ['displayName', 'photoURL'];
await updateJoinData(change, queryRef, joinFields, 'user');
```

```typescript
/**
 * Update foreign key join data
 * @param change - change event
 * @param queryRef - query for fk docs
 * @param fields - fields to update
 * @param field - field to store updated fields
 * @param isMap - see if field dot notation equals map, default true
 */
```

Because this is **trigger** function, you need to check for it at the top of your function:

```typescript
// don't run if repeated function
if (isTriggerFunction(change, context)) {
    return null;
}
```

**getJoinData**

If you plan on updating the same document that was triggered with different types of information, you may want to just get the join data to prevent multiple writes, and write to the trigger funciton later:

```typescript
const data = await getJoinData(change, queryRef, joinFields, 'user');

// run trigger
await triggerFunction(change, data);
```

By default, **updateJoinData** and **getJoinData** do not delete the data.  For example, the user's posts will not automatically be deleted if a user is deleted. You can change this default behavior by adding **true** as the last paramenter of the function.

```typescript
/**
 * Get data to join on document
 * @param change - change event
 * @param targetRef - the target document
 * @param fields - the fields to get from the target document
 * @param field - the field to store the target document fields
 * @param data - data object to update
 * @param alwaysCreate - create even if not necessary
 */
```

**Helper Functions**

There are several functions to check and see what kind of function is running:

```typescript
import { createDoc, updateDoc, deleteDoc } from 'adv-firestore-functions';
```

and for advanced checking:

```typescript
import { writeDoc, shiftDoc, popDoc } from 'adv-firestore-functions';
```

- writeDoc = createDoc || updateDoc  
- shiftDoc = createDoc || deleteDoc   
- popDoc = updateDoc || deleteDoc  

Also, remeber to pass in the change variable:

```typescript
import { createDoc } from 'adv-firestore-functions';

if (createDoc(change)) {
    // a document is being created, so do something...
}
```

*Note*: The above check functions are automatically used in the source code, so you don't need them for any of these functions out-of-the-box.

**valueChange** to see if a field has changed:

```typescript
if (valueChange(change, 'category')) {
// do something
}
```

```typescript
/**
 * Determine if a field value has been updated
 * @param change - change ref
 * @param val - field value
 */
```

**valueCreate** to see if a field has been created

```typescript
if (valueCreate(change, 'category')) {
// do something
}
```

```typescript
/**
 * Determine if a field has been created
 * @param change 
 * @param val - field
 * @returns
 */
```

**valueDelete** to see if a field has been deleted

```typescript
if (valueDelete(change, 'category')) {
// do something
}
```

```typescript
/**
 * Determine if a field has been deleted
 * @param change 
 * @param val - field
 * @returns
 */
```

**valueBefore** to see if there is a before value

```typescript
if (valueBefore(change, 'field')) {
// do something
}
```

```typescript
/**
 * Determine if there is a before value
 * @param change 
 * @param val 
 * @returns
 */
 ```

 **valueAfter** to see if there is an after value

```typescript
if (valueAfter(change, 'field')) {
// do something
}
```

```typescript
/**
 * Determine if there is an after value
 * @param change 
 * @param val 
 * @returns
 */
 ```

**getValue** to get the latest value of a field:

```typescript
const category = getValue(change, 'category');
```

Last, but not least I have these specific functions for categories. I will explain these in a front-end module eventually, but until then don't worry about them. I am adding the usage case just for completeness.

```typescript
/**
 * Returns the latest value of a field
 * @param change - change ref
 * @param val - field value
 */
```

**Tags**

You may have several types of tags on your collection. In order to index them, use this:

```typescript
await tagIndex(change, context);
```

The default field is **tags**, and the default collection to store them in is **_tags**, however you can change this and you can have more than one:

```typescript
await tagIndex(change, context, 'tags', '_tags');
```

Note: The tags are automatically aggregated into a doc 'tags/_all' to save you money on queries. You can set the limit and the name of the field.

*There is a 10 second delay before the aggregated tag doc (tags/_all) is updated to be sure each tag doc (tags/tag_name) has updated before the query begins.*

```typescript
/**
 * @param change - functions
 * @param context - event context
 * @param field - name of tags field in document
 * @param tagCol - name of tag index collection
 * @param createAllTags - boolean - create a doc '_all' containing all tags
 * @param aggregateField - the name of the field to aggregate, default tagAggregate
 * @param allTagsName - name of all tags doc, default '_all'
 * @param maxNumTags - the maximum number of tags to put in a doc, default is 100
 */
```

**Bulk Delete**

You can delete documents in bulk using chunking at 100 docs. The input is an array of document references. This bypasses the 600 document limit, but be aware I do not know what happens when that numbers gets high enough.

```typescript
const querySnap = db.collection('your query');
const docRefs: any = [];
querySnap.forEach((q: any) => {
    docRefs.push(q.ref);
});
await bulkDelete(docRefs);
```

```typescript
/**
 * Bulk delete data
 * @param docs - doc references to delete
 * @param field - field to delete
 */
```

**Bulk Update**

Same for bulk update. The data is an object of whatever values you want to update...

```typescript
const data: any = {};
data[somethink] = 'some stuff';
await bulkUpdate(docRefs, data);
```

*!!Warning!!* - I would suggest not deleting many documents, or even using foreign keys for more than 2000 or so documents. You would have to update every single one of them if a value changes.  In that case, it is best to just read the foreign document on the front end, even though you would incur more reads.

```typescript
/**
 * bulk update data
 * @param docs - doc references to update
 * @param field - field to update
 * @param data - data to update
 */
```

**Category counters**

This is specific if you want to index categories. I will eventually post code on this to explain it, but usage is like so:

On the **posts** collection, or whatever your categories contain:

```typescript
// [collection]Count on categories and its subcategories
await catDocCounter(change, context);
```

```typescript
/**
 * Count number of documents in a category
 * @param change - change ref
 * @param context - context event
 * @param counter - counter field name, default colCount
 * @param pathField - default catPath
 * @param arrayField - default catArray
 * @param field - default 'category'
 * @param catCol - default 'categories'
 */
```

On the **categories** collection:

```typescript
// update all sub category counters
await subCatCounter(change, context);
```

```typescript
/**
 * Count number of subcategories in a category
 * @param change - change ref
 * @param context - event context
 * @param counter - default catCount
 * @param parentField - parent category field name
 * @param pathField - default catPath
 */
```

I will try and update the documention as these functions progress. There are plenty of logging, so check your firebase function logs for problems!

Also, note that you can just pass in 'undefined' if you don't want to change the default value in most of these functions.

Example:

```typescript
await tagIndex(change, context, 'tags', '_tags', undefined, 'tAggregate');
```

There is more to come as I simplify my firebase functions!
See [Fireblog.io][1] for more examples (whenever I finally update it)!

[1]: http://fireblog.io "Fireblog.io"
