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

[HOME](README.md)