/**
 * These functions do not do anything and are for future development only!!!
 * You can basically ignore this file.
 */

import * as admin from 'firebase-admin';

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

interface BTreeNode {
  values: string[];
  parent: string;
  left?: string;
  right?: string;
  size?: number;
}

class BTree {
  db: FirebaseFirestore.Firestore;
  indexCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
  searchCol: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
  order: number;
  query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>;

  constructor(
    searchCol: string,
    indexCol: string,
    query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>,
    order = 3,
  ) {
    this.db = admin.firestore();
    this.indexCol = this.db.collection(indexCol);
    this.searchCol = this.db.collection(searchCol);
    this.order = order;
    this.query = query;
  }

  async treeInsert(id: string, nodeId?: string) {
    try {
      // get root
      const currentNode = await this.getRootNode();

      // if no root
      if (currentNode.empty) {
        // insert at root
        const rootNode = { values: [id], size: 1, parent: null, children: [null] };
        this.indexCol.add(rootNode);
        return;
      }
      // get search node values
      const beforeId = await this.getBeforeId(id);

      const searchNode = await this.getNode(beforeId);
      const values = searchNode.data().values;

      // add value to correct place in array
      values.splice(values.indexOf(beforeId) + 1, 0, id);

      // see if room in node
      if (values.length < this.order) {
        // add values to search node
        const increment = admin.firestore.FieldValue.increment(1);
        searchNode.ref.set({ values, size: increment }, { merge: true });
      } else {
        this.splitNode(values, searchNode);
      }
    } catch (e) {
      console.log(e);
    }
  }

  private async splitNode(
    values: string[],
    node: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>,
  ) {
    // get values for nodes
    const midIndex = Math.floor(this.order / 2);
    const mid = values.slice(midIndex, midIndex + 1);
    const left = values.slice(0, midIndex);
    const right = values.slice(midIndex + 1);

    // replace current node with left node
    const leftNode = { values: left, size: left.length, parent: node.id, children: [null] };
    await node.ref.set(leftNode);

    // create right node
    const rightNode = { values: right, size: right.length, parent: node.id, children: [null] };
    const rightRef = await this.indexCol.add(rightNode);

    // add mid value to parent
    const parent = node.data().parent;

    if (!parent) {
      const parentNode = { values: mid, size: mid.length, parent: null, left: node.id, right: rightRef.id };
      this.indexCol.add(parentNode);
    } else {
      this.treeInsert(parent);
    }
    return;
  }
  /**
   * Get root node
   */
  private async getRootNode() {
    return await this.indexCol.where('parent', '==', null).limit(1).get();
  }
  /**
   * Returns the node containing the id in the index collection
   * @param beforeId
   */
  private async getNode(id: string) {
    const docRef = await this.indexCol.where('values', 'array-contains', id).limit(1).get();
    return docRef.docs[0];
  }
  /**
   * Returns the doc id of the item before in the search collection
   * @param id - search id
   */
  async getBeforeId(id: string) {
    const docSnap = await this.searchCol.doc(id).get();
    const beforeDocs = await this.query.endBefore(docSnap).limitToLast(1).get();
    return beforeDocs.docs[0].id;
  }
}

main();

async function main() {
  const q = admin.firestore().collection('posts').orderBy('title', 'asc');

  const t = new BTree('posts', '_nodes', q);

  await t.treeInsert('pQTWLMVJU7vs0nzTuJWT');
  await t.treeInsert('Rx78XRAe0u2i5XkLaN24');
  await t.treeInsert('opkz4gTtZJcfYkEGQ3KB');

  /*const e: string[] = [];
  const ids = await q.get(); 
  ids.forEach((r: FirebaseFirestore.QueryDocumentSnapshot) => {
    e.push(r.id);
  });

  console.log(JSON.stringify(e));*/
}

/*

["pQTWLMVJU7vs0nzTuJWT","Rx78XRAe0u2i5XkLaN24","opkz4gTtZJcfYkEGQ3KB","bYuHjNCPkeAGmtbcA1rD",
"aYQEvBC9Yj9DDBswyby3","lN9RVa6VXIlBSfRMbgjn","xqXJjnMUbxfmnqAAnOwA","MIXQWZW6VQyUr67K2WuM",
"uT9S8KeKcRSLgV5Ad2lU","ZyxIobf06OFIHxBcpJb4"]

*/
