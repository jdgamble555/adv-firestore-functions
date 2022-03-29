import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { DocumentSnapshot } from 'firebase-admin/firestore';
import { findSingleValues, updateDoc, getValue, getBefore, getAfter, getCollection } from './tools';
import { DocumentRecord } from './types';
import { aggregateData } from './joins';
import { queryCounter } from './counters';

try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();
/**
 * Update a tag collection automatically
 * @param change - functions
 * @param context - event context
 * @param field - name of tags field in document
 * @param tagCol - name of tag index collection
 * @param createAllTags - boolean - create a doc '_all' containing all tags
 * @param aggregateField - the name of the field to aggregate, default tagAggregate
 * @param allTagsName - name of all tags doc, default '_all'
 * @param maxNumTags - the maximum number of tags to put in a doc, default is 100
 */
export async function tagIndex(
  change: functions.Change<DocumentSnapshot<DocumentRecord<string, string[]>>>,
  context: functions.EventContext,
  field = 'tags',
  tagCol = '_tags',
  createAllTags = true,
  aggregateField = '',
  allTagsName = '_all',
  maxNumTags = 100,
) {
  const collectionId = getCollection(context);

  let tags = getValue(change, field) ?? [];
  const after = getAfter(change, field) ?? [];

  if (updateDoc(change)) {
    // get only changed tags
    tags = findSingleValues(getBefore(change, field) ?? [], after);
  }

  const queries: Promise<void | FirebaseFirestore.WriteResult | FirebaseFirestore.Transaction | null>[] = [];

  // go through each changed tag
  for (const tag of tags) {
    // restrict tag string
    const _tag = tag
      .toLowerCase()
      .replace(/-+/g, ' ')
      .replace(/[^\w ]+/g, '');

    // delete or add tag
    const n = after.includes(_tag) ? 1 : -1;
    if (n === 1) {
      console.log('added');
    } else {
      console.log('deleted');
    }

    // queries
    const queryRef = db.collection(collectionId).where(field, 'array-contains', `${_tag}`);
    const tagRef = db.doc(`${tagCol}/${_tag}`);

    // update tag counts on tags
    queries.push(queryCounter(change, context, queryRef, tagRef, 'count', 1, n, false));
  }

  await Promise.all(queries);

  // update tag aggregation
  if (createAllTags) {
    if (!aggregateField) {
      aggregateField = tagCol + 'Aggregate';
    }

    const tagRef = db.collection(tagCol).doc(allTagsName);
    // get all tags except aggregation tag
    const tagQueryRef = db.collection(tagCol).where(admin.firestore.FieldPath.documentId(), '!=', allTagsName);
    await aggregateData(change, context, tagRef, tagQueryRef, undefined, aggregateField, maxNumTags, undefined, true);
  }
  return null;
}
