import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
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
 */
export async function tagIndex(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext,
  field = 'tags',
  tagCol = '_tags',
) {
  const colId = context.resource.name.split('/')[5];

  // simplify event types
  const updateDoc = change.before.exists && change.after.exists;

  // simplify input data
  const after: any = change.after.exists ? change.after.data() : null;
  const before: any = change.before.exists ? change.before.data() : null;

  let tags: any[] = after ? after[field] : before[field];

  const { findSingleValues } = require('./tools');
  const { queryCounter } = require('./counters');

  if (updateDoc) {
    // get only changed tags
    tags = findSingleValues(before[field], after[field]);
  }
  // go through each changed tag
  tags.forEach(async (tag: string) => {
    // restrict tag string
    const _tag = tag
      .toLowerCase()
      .replace(/-+/g, ' ')
      .replace(/[^\w ]+/g, '');

    // delete or add tag
    const n = after.tags.includes(_tag) ? 1 : -1;

    // queries
    const queryRef = db.collection(colId).where(tagCol, 'array-contains', `${_tag}`);
    const tagRef = db.doc(`${tagCol}/${_tag}`);

    // update tag counts on tagsDoc
    await queryCounter(change, context, queryRef, tagRef, 'count', 1, n);
  });
  return null;
}
