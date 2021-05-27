# Advanced Firestore Functions

[HOME](README.md)

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

[HOME](README.md)