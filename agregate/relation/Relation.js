// @flow
import "../polyfill";
import { Cypher as C, Var } from "../cypher";
import { BaseRelation } from "./BaseRelation";

import * as queryBuilder from "../util/queryBuilder";
import acceptsTransaction from "../util/acceptsTransaction";
import { Record } from "../record/Record";
import * as R from "ramda";

export class Relation extends BaseRelation {
  @acceptsTransaction
  async only(record: Record) {
    if (arguments.length === 0) {return (await this.entries())[0]} else if (record === null) {return await this.clear()} else if (!(record instanceof Record)) {throw new TypeError} else {
      await this.clear()
      await this.add([record])
    }
  }

  get boundOnly(): Function {
    const bound = this.only.bind(this);
    bound.source = this.source;
    bound.label = this.label;
    bound.direction = this.direction;
    bound.targetLabel = this.targetLabel;
    bound.isOnly = true;
    return bound;
  }

  @acceptsTransaction
  @acceptsRecords
  async has(records: Record[]) {
    const relation = new Var();
    const target = new Var();
    return (await this.connection.query(C.tag`
            ${this.__namedSelfQuery(new Var(), relation, target)}
                WHERE ${target}.uuid IN ${records.map(record => record.uuid)}

            RETURN count(${relation}) = ${records.length} as exists`))[0][0]
  }

  @acceptsTransaction
  @acceptsRecords
  async intersect(records: Record[]) {
    const target = new Var();
    return R.transpose(await this.connection.query(C.tag`
            ${this.__namedSelfQuery(new Var(), new Var(), target)}
                WHERE ${target}.uuid IN ${records.map(record => record.uuid)}

            RETURN ${target}`))[0]
  }

  @acceptsTransaction
  @acceptsRecords
  async add(records: Record[]) {
    if (this.source instanceof Relation) {throw new TypeError('cannot add entries to meta-relation due to uncertainty')}

    const source = new Var();
    const target = new Var();
    const relation = new Var();

    await this.connection.query(C.tag`
            MATCH ${this.__source(source)}
            MATCH ${this.__target(target)}
                WHERE ${target}.uuid IN ${records.map(record => record.uuid)}

            MERGE (${source})${this.__rel(relation)}(${target})`)
  }

  // noinspection ReservedWordAsName - relation is trying to re-use Set API

  @acceptsTransaction
  @acceptsRecords
  async delete(records: Record[]) {
    const source = new Var();
    const target = new Var();
    const relation = new Var();
    await this.connection.query(C.tag`
            ${this.__namedSelfQuery(source, relation, target)}
                WHERE ${target}.uuid IN ${records.map(record => record.uuid)}

            DELETE ${relation}`)
  }

  @acceptsTransaction
  async clear() {
    const source = new Var();
    const target = new Var();
    const relation = new Var();
    await this.connection.query(C.tag`
            ${this.__namedSelfQuery(source, relation, target)}

            DELETE ${relation}`)
  }

  @acceptsTransaction
  async size(): Promise<number> {
    const source = new Var();
    const target = new Var();
    const relation = new Var();

    const [[relationCount]] = await this.connection.query(C.tag`
            ${this.__namedSelfQuery(source, relation, target)}

            RETURN count(${relation}) as relationCount`)
    return relationCount;
  }

  @acceptsTransaction
  entries() { return this.where() }

  @acceptsTransaction
  async where(params: {} | {}[] = {}, opts: { order?: string | string[], offset?: number, limit?: number } = {}) {
    const source = new Var();
    const target = new Var();
    const relation = new Var();

    const result = await this.connection.query(C.tag`
            ${this.__namedSelfQuery(source, relation, target)}
            ${queryBuilder.whereQuery(target, params)}
            RETURN ${target}
            ${queryBuilder.whereOpts(target, opts)}`);

    return R.transpose(result)[0] || [];
  }
}

function acceptsRecords(target, name, desc) {
  const { value } = desc;

  desc.value = function (_records, ...rest) {
    const records = Array.isArray(_records) ? _records : [_records];

    this.__targetCheck(records);

    return value.apply(this, [records, ...rest]);
  }
}
