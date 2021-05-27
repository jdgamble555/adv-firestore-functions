# Advanced Firestore Functions

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

If you plan on updating the same document that was triggered with different types of information, you may want to just get the join data to prevent multiple writes, and write to the trigger funciton later. This is actually the internal function for **createJoinData**.

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

[HOME](README.md)