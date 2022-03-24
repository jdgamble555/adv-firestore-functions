import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { CollectionReference, DocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';
import { eventExists } from './events';
import { bulkDelete, ArrayChunk } from './bulk';
import {
  popDoc,
  deleteDoc,
  valueChange,
  fkChange,
  getValue,
  writeDoc,
  createDoc,
  getAfter,
  generateTrigrams,
} from './tools';
import { DocumentRecord } from './types';
import { htmlToText } from 'html-to-text';

type RelevantSearchOptions = {
  query: string;
  col: string;
  fields: string | string[];
  searchCol: string;
  termField: string;
  filterFunc?: (value: string) => string;
  limit?: number;
  startId?: string;
};

type RelevantIndexOptions = {
  fields: string | string[];
  searchCol?: string;
  numWords?: number;
  combine?: boolean;
  combinedCol?: string;
  termField?: string;
  filterFunc?: (value: string) => string;
};

type RelevantSearchResult = { id: string; relevance: number };

try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();
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
export async function fullTextIndex(
  change: functions.Change<DocumentSnapshot<DocumentRecord<string, string>>>,
  context: functions.EventContext,
  field: string,
  fk = 'id',
  type = 'id',
  n = 6,
  searchCol = '_search',
) {
  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }
  // get collection
  const colId = context.resource.name.split('/')[5];
  const { docId } = context.params as { docId?: string };
  if (typeof docId !== 'string' || docId.length < 1) {
    throw new Error('Missing doc Id');
  }

  // delimter
  const delim = '__';

  // term field for maps and arrays
  const termName = '_terms';

  // update or delete
  if (popDoc(change)) {
    // if deleting doc, field change, or foreign key change
    if (deleteDoc(change) || valueChange(change, field) || fkChange(change, fk)) {
      // get old key to delete
      const fkValue = getValue(change, fk);

      // remove old indexes
      const delDocs: FirebaseFirestore.DocumentReference[] = [];

      // see if search for id field
      const sfk = fk === 'id' ? admin.firestore.FieldPath.documentId() : fk;

      const searchSnap = await db.collection(`${searchCol}/${colId}/${field}`).where(sfk, '==', fkValue).get();
      searchSnap.forEach((doc) => {
        // collect all document references
        delDocs.push(doc.ref);
      });

      // delete data
      bulkDelete(delDocs);
    }
  }
  // create or update
  if (writeDoc(change)) {
    // if creating a doc, field change, or foreign key change
    if (createDoc(change) || valueChange(change, field) || fkChange(change, fk)) {
      // add new foreign key field(s)
      // TODO: This doesn't seem right? getValue not really setup to deal with arrays
      const fkeys = {} as DocumentRecord<string, string>;
      // if (Array.isArray(fk)) {
      //   fk.forEach((k) => {
      //     fkeys[k] = getValue(change, k);
      //   });
      // } else {
      fkeys[fk] = getValue(change, fk);
      // }
      // new indexes
      const fieldValue = getAfter(change, field);

      if (fieldValue === null || fieldValue === undefined) {
        return;
      }

      // TODO: not an array
      // if array, turn into string
      // if (Array.isArray(fieldValue)) {
      //   fieldValue = fieldValue.join(' ');
      // }

      console.log('Generating index array on ', field, ' field');
      const index = createIndex(fieldValue, n);
      const numDocs = index.length;

      // chunk index array at 100 items
      const chunks = new ArrayChunk(index);
      chunks.forEachChunk(async (ch) => {
        const batch = db.batch();
        // create the docs in batches
        ch.forEach((phrase: string) => {
          if (!phrase) {
            return;
          }
          const searchRef = db.doc(`${searchCol}/${colId}/${field}/${phrase}${delim}${docId}`);
          const data = {} as DocumentRecord<string, string[] | DocumentRecord<string, boolean>>;

          // if index for array and map types
          if (type === 'map' || type === 'array') {
            // map and array term index

            let v = '';
            const a = [] as string[];
            const m = {} as DocumentRecord<string, boolean>;
            for (let i = 0; i < phrase.length; i++) {
              v = phrase.slice(0, i + 1);
              if (type === 'map') {
                m[v] = true;
              } else {
                a.push(v);
              }
            }
            data[termName] = type === 'map' ? m : a;
          }
          batch.set(searchRef, { ...fkeys, ...data }, { merge: true });
        });
        console.log('Creating batch of docs on ', field, ' field');
        await batch.commit().catch((e) => {
          console.log(e);
        });
      });
      console.log('Finished creating ', numDocs, ' docs on ', field, ' field');
    }
  }
  return null;
}
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
 * @retuns - will return a sorted array of docs with {id, relevance}
 *   the higher the relevance, the better match it is...
 */
export async function relevantSearch({
  query,
  col,
  fields = ['_all'],
  searchCol = '_search',
  termField = '_term',
  filterFunc,
  limit,
  startId,
}: RelevantSearchOptions): Promise<RelevantSearchResult[]> {
  // if soundex function or other filter
  const exp =
    filterFunc !== undefined
      ? query
          .split(' ')
          .map((v) => filterFunc(v))
          .join(' ')
      : query;

  if (typeof fields === 'string') {
    fields = [fields];
  }

  if (fields[0] === '_all') {
    // if start id
    const start = startId ? db.doc(`${searchCol}/${col}/_all/${startId}`) : [];

    const query = limit
      ? db.collection(`${searchCol}/${col}/_all`).orderBy(`${termField}.${exp}`, 'desc').limit(limit).startAfter(start)
      : db.collection(`${searchCol}/${col}/_all`).orderBy(`${termField}.${exp}`, 'desc');

    // return results
    const docsSnap = await query.get();

    return docsSnap.docs.map((doc) => {
      const { _term } = doc.data() as { _term?: DocumentRecord<string, number> };
      const id = doc.id;
      const relevance = _term?.[exp] as number;
      return { id, relevance } as RelevantSearchResult;
    });
  }

  // get queries for each field
  const s = [];
  for (const field of fields) {
    const query = limit
      ? db.collection(`${searchCol}/${col}/${field}`).orderBy(`${termField}.${exp}`, 'desc').limit(limit)
      : db.collection(`${searchCol}/${col}/${field}`).orderBy(`${termField}.${exp}`, 'desc');
    s.push(query.get());
  }
  const docsSnaps = await Promise.all(s);
  const ids = {} as DocumentRecord<string, number>;
  let i = 0;

  // return merged results
  return docsSnaps
    .map((q) => {
      // get relevant info from docs
      return q.docs.map((doc) => {
        const { _term } = doc.data() as { _term?: DocumentRecord<string, number> };
        const id = doc.id;
        const relevance = _term?.[exp] as number;
        return { id, relevance } as RelevantSearchResult;
      });
    })
    .flat()
    .filter((r) => {
      const { id, relevance } = r;
      ids[id] = relevance + (ids[id] ?? 0);
      return r;
    })
    .map((r) => {
      // merge relevances
      const value = ids[r.id];
      if (value !== undefined) {
        r.relevance = value;
      }
      return r;
      return r;
      // sort by relevance again
    })
    .sort((a, b) => (b.relevance < a.relevance ? -1 : a.relevance ? 1 : 0))
    .filter((r) => {
      // limit limit
      if (i < (limit ?? Number.MAX_SAFE_INTEGER)) {
        ++i;
        return r;
      }
      return;
    });
}
/**
 * Trigram Search callable function
 * @param _opts {
 *   query - query to search
 *   col - collection to search
 *   fields - fields to search
 *   searchCol - name of search collection, default _search
 *   termField - name of term field to search, default _term
 *   limit - number of search results to limit, default 10
 * }
 * @retuns - will return a sorted array of docs with {id, relevance}
 *   the higher the relevance, the better match it is...
 */
type TrigramSearchOptions = {
  query: string;
  col: string;
  fields?: string[];
  searchCol?: string;
  termField?: string;
  limit?: number;
};

type TrigramSearchResult = { id: string; relevance: number };

export async function trigramSearch({
  query,
  col,
  fields = ['_all'],
  searchCol = '_trigrams',
  termField = '_term',
  limit = 10,
}: TrigramSearchOptions): Promise<TrigramSearchResult[]> {
  // trigram function
  function tg(s1: string) {
    const n = 3;
    const r: string[] = [];
    for (let k = 0; k <= s1.length - n; k++) r.push(s1.substring(k, k + n));
    return r;
  }

  const trigrams = tg(query);
  const s = [];
  const searchable = [];

  // create searchable queries
  searchable.push({ s: trigrams, r: 3 });

  for (const a of trigrams) {
    const tg2 = trigrams.filter((t) => t !== a);
    searchable.push({ s: tg2, r: 2 });
    for (const b of tg2) {
      const tg3 = tg2.filter((t) => t !== b);
      searchable.push({ s: tg3, r: 1 });
    }
  }

  // go through each field
  for (const field of fields) {
    // go through all searchable queries
    for (const gram of searchable) {
      const query = db.collection(`${searchCol}/${col}/${field}`) as CollectionReference<{ relevance: number }>;
      let newRef = query;
      for (const t of gram.s) {
        newRef = newRef.where(`${termField}.${t}`, '==', true) as CollectionReference<{ relevance: number }>;
      }
      // push to new query
      s.push(
        newRef.get().then((r: QuerySnapshot) => {
          return { ...r, relevance: gram.r };
        }),
      );
    }
  }

  const docsSnaps = await Promise.all(s);
  const ids = {} as DocumentRecord<string, number>;
  let i = 0;

  // return merged results
  return docsSnaps
    .map((q) => {
      // get relevant info from docs
      return q.docs.map((doc) => {
        const id = doc.id;
        const data = doc.data();
        const relevance = q.relevance;
        return { id, relevance, ...data };
      });
    })
    .flat()
    .filter((r) => {
      const { id, relevance } = r;
      // filter duplicates
      ids[id] = relevance + (ids[id] ?? 0);
      return r;
    })
    .map((r) => {
      // merge relevances
      const value = ids[r.id];
      if (value !== undefined) {
        r.relevance = value;
      }
      return r;
      // sort by relevance again
    })
    .sort((a, b) => (b.relevance < a.relevance ? -1 : a.relevance ? 1 : 0))
    .filter((r) => {
      // limit limit
      if (i < limit ?? Number.MAX_SAFE_INTEGER) {
        ++i;
        return r;
      }
      return;
    });
}
/**
 * indexes a collection by relevance
 * @param change
 * @param context
 * @param _opts: {
 *   fields - array of fields to index
 *   searchCol - name of search collection, default _search
 *   numWords - number of words to index at a time, default 6
 *   combine - whether or not to combine fields in one collection, default true
 *   combinedCol - name of combined fields collection, default _all
 *   termField - name of terms array, default _term
 *   filterFunc - function to filter, can pass a soundex function
 * }
 */
export async function relevantIndex(
  change: functions.Change<DocumentSnapshot<DocumentRecord<string, string>>>,
  context: functions.EventContext,
  {
    fields,
    searchCol = '_search',
    numWords = 6,
    combine = true,
    combinedCol = '_all',
    termField = '_term',
    filterFunc,
  }: RelevantIndexOptions,
) {
  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }
  // get collection
  const colId = context.resource.name.split('/')[5];
  const { docId } = context.params as { docId?: string };
  if (typeof docId !== 'string' || docId.length < 1) {
    throw new Error('Missing doc Id');
  }

  if (typeof docId !== 'string' || docId.length < 1) {
    throw new Error('Missing doc Id');
  }

  const searchRef = db.doc(`${searchCol}/${colId}/${combinedCol}/${docId}`);

  if (typeof fields === 'string') {
    fields = [fields];
  }

  // delete
  if (deleteDoc(change)) {
    if (combine) {
      await searchRef.delete();
    } else {
      for (const field of fields) {
        const searchRefF = db.doc(`${searchCol}/${colId}/${field}/${docId}`);
        await searchRefF.delete();
      }
    }
  }
  // create or update
  if (writeDoc(change)) {
    const data = {} as DocumentRecord<string, string | DocumentRecord<string, number>>;
    let m = {} as DocumentRecord<string, number>;

    // go through each field to index
    for (const field of fields) {
      // new indexes
      let fieldValue = getAfter(change, field);

      // if array, turn into string
      if (Array.isArray(fieldValue)) {
        fieldValue = fieldValue.join(' ');
      }

      if (fieldValue === null || fieldValue === undefined) {
        return;
      }

      let index = createIndex(fieldValue, numWords);

      // if filter function, run function on each word
      if (filterFunc) {
        const temp = [];
        for (const i of index) {
          temp.push(
            i
              .split(' ')
              .map((v: string) => filterFunc(v))
              .join(' '),
          );
        }
        index = temp;
        for (const phrase of index) {
          if (phrase) {
            let v = '';
            const t = phrase.split(' ');
            while (t.length > 0) {
              const r = t.shift() ?? '';
              v += v ? ' ' + r : r;
              // increment for relevance
              m[v] = m[v] ?? 0 + 1;
            }
          }
        }
      } else {
        for (const phrase of index) {
          if (phrase) {
            let v = '';
            for (let i = 0; i < phrase.length; i++) {
              v = phrase.slice(0, i + 1);
              // increment for relevance
              m[v] = m[v] ?? 0 + 1;
            }
          }
        }
      }

      // index individual field
      if (!combine) {
        data[termField] = m;
        console.log('Creating relevant index on ', field, ' field for ', colId + '/' + docId);
        const searchRefF = db.doc(`${searchCol}/${colId}/${field}/${docId}`);
        await searchRefF.set(data).catch((e) => {
          console.log(e);
        });
        // clear index history
        m = {};
      }
    }
    if (combine) {
      data[termField] = m;
      console.log('Saving new relevant index for ', colId + '/' + docId);
      await searchRef.set(data).catch((e) => {
        console.log(e);
      });
    }
  }
  return null;
}
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
type TrigramIndexOptions = {
  trigramCol?: string;
  combinedCol?: string;
  combine?: boolean;
  termField?: string;
  fields: string[];
};

export async function trigramIndex(
  change: functions.Change<DocumentSnapshot<DocumentRecord<string, string>>>,
  context: functions.EventContext,
  { trigramCol = '_trigrams', combinedCol = '_all', combine = true, termField = '_term', fields }: TrigramIndexOptions,
) {
  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }
  // get collection
  const colId = context.resource.name.split('/')[5];
  const { docId } = context.params as { docId?: string };
  if (typeof docId !== 'string' || docId.length < 1) {
    throw new Error('Missing doc Id');
  }
  const trigramRef = db.doc(`${trigramCol}/${colId}/${combinedCol}/${docId}`);

  // delete
  if (deleteDoc(change)) {
    if (combine) {
      await trigramRef.delete();
    } else {
      for (const field of fields) {
        const trigramRefF = db.doc(`${trigramCol}/${colId}/${field}/${docId}`);
        await trigramRefF.delete();
      }
    }
  }
  // create or update
  if (writeDoc(change)) {
    let data = {} as DocumentRecord<string, string | DocumentRecord<string, boolean>>;
    let m = {} as DocumentRecord<string, boolean>;

    // go through each field to index
    for (const field of fields) {
      // new indexes
      let fieldValue = getAfter(change, field);

      // if array, turn into string
      if (Array.isArray(fieldValue)) {
        fieldValue = fieldValue.join(' ');
      }
      if (fieldValue === null || fieldValue === undefined) {
        return;
      }
      // generate trigrams
      const index = createIndex(fieldValue, 0).join(' ');
      const tg = generateTrigrams(index);
      for (const gram of tg) {
        m[gram] = true;
      }
      // save data to doc
      data[`_${field}`] = index;

      // index individual field
      if (!combine) {
        data[termField] = m;
        console.log('Creating trigram index on ', field, ' field for ', colId + '/' + docId);
        const searchRefF = db.doc(`${trigramCol}/${colId}/${field}/${docId}`);
        await searchRefF.set(data).catch((e) => {
          console.log(e);
        });
        // clear index history
        m = {};
        data = {};
      }
    }
    if (combine) {
      data[termField] = m;
      console.log('Saving new trigram index for ', colId + '/' + docId);
      await trigramRef.set(data).catch((e) => {
        console.log(e);
      });
    }
  }
  return null;
}
/**
 * Returns a search array ready to be indexed
 * @param html - to be parsed for indexing
 * @param n - number of words to index
 * @returns - array of indexes
 */
function createIndex(html: string, n: number) {
  // get rid of pre code blocks
  function beforeReplace(text: string) {
    return text.replace(/&nbsp;/g, ' ').replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, '');
  }
  // create document after text stripped from html
  function createDocs(text: string) {
    const finalArray: string[] = [];
    const wordArray = text
      .toLowerCase()
      // fix only english problem, get unicode for any language
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/ +/g, ' ')
      .split(' ');
    do {
      finalArray.push(wordArray.slice(0, n).join(' '));
      wordArray.shift();
    } while (wordArray.length !== 0);
    return finalArray;
  }
  // strip text from html
  // get rid of code first
  return createDocs(htmlToText(beforeReplace(html), { ignoreHref: true, ignoreImage: true }));
}
