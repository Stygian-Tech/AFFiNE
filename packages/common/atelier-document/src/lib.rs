//! Structured Automerge checkpoints for the Atelier BlockSuite compatibility gate.
//! All editor positions use UTF-16 code units, matching browser text APIs.
use automerge::{
  ActorId, AutoCommit, Cursor, ObjId, ObjType, Prop, ROOT, ReadDoc, ScalarValue, TextEncoding, Value,
  marks::{ExpandMark, Mark},
  sync::{Message, State, SyncDoc},
  transaction::Transactable,
};
use serde::Deserialize;
use serde_json::{Value as Json, json};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
  e.to_string()
}
fn js(e: String) -> JsValue {
  JsValue::from_str(&e)
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
  Set {
    path: Vec<String>,
    value: Json,
  },
  Delete {
    path: Vec<String>,
  },
  SpliceList {
    path: Vec<String>,
    index: usize,
    delete: usize,
    values: Vec<Json>,
  },
  Batch {
    commands: Vec<Command>,
  },
  SpliceText {
    path: Vec<String>,
    index: usize,
    delete: usize,
    text: String,
  },
  MarkText {
    path: Vec<String>,
    start: usize,
    end: usize,
    name: String,
    value: Json,
  },
}

#[derive(Clone)]
enum Undo {
  Unsupported(&'static str),
  Set {
    parent: ObjId,
    key: String,
    written: ObjId,
    applied: Json,
    previous: Option<(Json, ObjId)>,
  },
  Text {
    object: ObjId,
    inserted: HashSet<ObjId>,
    removed: String,
    marks: Vec<Mark>,
    anchor: Cursor,
  },
}

#[wasm_bindgen]
pub struct DocumentEngine {
  doc: AutoCommit,
  peers: HashMap<String, State>,
  history: Vec<Undo>,
}

#[wasm_bindgen]
impl DocumentEngine {
  #[wasm_bindgen(constructor)]
  pub fn new(document_id: &str, actor: Option<String>) -> std::result::Result<DocumentEngine, JsValue> {
    Self::create(document_id, actor.as_deref()).map_err(js)
  }
  #[wasm_bindgen(js_name = load)]
  pub fn load(bytes: &[u8], actor: Option<String>) -> std::result::Result<DocumentEngine, JsValue> {
    Self::from_bytes(bytes, actor.as_deref()).map_err(js)
  }
  #[wasm_bindgen(js_name = importSnapshot)]
  pub fn import_snapshot(&mut self, snapshot: &str) -> std::result::Result<(), JsValue> {
    self
      .import(&serde_json::from_str(snapshot).map_err(|e| js(err(e)))?)
      .map_err(js)
  }
  pub fn snapshot(&self) -> std::result::Result<String, JsValue> {
    self.snapshot_json().map(|v| v.to_string()).map_err(js)
  }
  pub fn save(&mut self) -> Vec<u8> {
    self.doc.save()
  }
  pub fn heads(&mut self) -> String {
    json!(self.doc.get_heads().iter().map(ToString::to_string).collect::<Vec<_>>()).to_string()
  }
  #[wasm_bindgen(js_name = applyCommand)]
  pub fn apply_command(&mut self, command: &str) -> std::result::Result<(), JsValue> {
    self
      .apply(serde_json::from_str(command).map_err(|e| js(err(e)))?)
      .map_err(js)
  }
  pub fn merge(&mut self, bytes: &[u8]) -> std::result::Result<(), JsValue> {
    self.merge_bytes(bytes).map_err(js)
  }
  pub fn undo(&mut self) -> std::result::Result<bool, JsValue> {
    self.undo_local().map_err(js)
  }
  #[wasm_bindgen(js_name = generateSyncMessage)]
  pub fn generate_sync_message(&mut self, peer: &str) -> Option<Vec<u8>> {
    self
      .doc
      .sync()
      .generate_sync_message(self.peers.entry(peer.into()).or_default())
      .map(|m| m.encode())
  }
  #[wasm_bindgen(js_name = receiveSyncMessage)]
  pub fn receive_sync_message(&mut self, peer: &str, bytes: &[u8]) -> std::result::Result<(), JsValue> {
    let message = Message::decode(bytes).map_err(|e| js(err(e)))?;
    // Stage synchronization so unsupported checkpoints never replace the active document.
    let mut candidate = self.doc.clone();
    let mut state = self.peers.get(peer).cloned().unwrap_or_default();
    candidate
      .sync()
      .receive_sync_message(&mut state, message)
      .map_err(|e| js(err(e)))?;
    validate(&candidate).map_err(js)?;
    self.doc = candidate;
    self.peers.insert(peer.into(), state);
    Ok(())
  }
}

impl DocumentEngine {
  pub fn create(id: &str, actor: Option<&str>) -> Result<Self> {
    validate_identity(id, actor)?;
    let mut doc = AutoCommit::new_with_encoding(TextEncoding::Utf16CodeUnit);
    if let Some(actor) = actor {
      doc.set_actor(ActorId::from(actor.as_bytes()));
    }
    write_json(&mut doc, &ROOT, "schemaVersion".into(), &json!(2), false)?;
    write_json(&mut doc, &ROOT, "documentId".into(), &json!(id), false)?;
    write_json(&mut doc, &ROOT, "rootId".into(), &Json::Null, false)?;
    for key in ["metadata", "blocks"] {
      write_json(&mut doc, &ROOT, key.into(), &json!({}), false)?;
    }
    doc.commit();
    Ok(Self {
      doc,
      peers: HashMap::new(),
      history: vec![],
    })
  }
  pub fn from_bytes(bytes: &[u8], actor: Option<&str>) -> Result<Self> {
    if actor.is_some_and(str::is_empty) {
      return Err("actor ID must not be empty".into());
    }
    let mut doc = AutoCommit::load_with_options(
      bytes,
      automerge::LoadOptions::new().text_encoding(TextEncoding::Utf16CodeUnit),
    )
    .map_err(err)?;
    validate(&doc)?;
    if let Some(actor) = actor {
      doc.set_actor(ActorId::from(actor.as_bytes()));
    } else {
      doc.set_actor(ActorId::random());
    }
    Ok(Self {
      doc,
      peers: HashMap::new(),
      history: vec![],
    })
  }
  pub fn snapshot_json(&self) -> Result<Json> {
    read_object(&self.doc, &ROOT)
  }
  pub fn import(&mut self, snapshot: &Json) -> Result<()> {
    validate_snapshot(snapshot)?;
    let identity = read_property(&self.doc, &ROOT, "documentId".into())?.ok_or("missing document identity")?;
    if snapshot["documentId"] != identity {
      return Err("snapshot document identity differs from initialized document".into());
    }
    // Import only into an empty document, never destructively replace a live replica.
    let blocks = object_at(&self.doc, &["blocks".into()])?;
    if self.doc.length(&blocks) != 0 {
      return Err("snapshot import requires an empty document".into());
    }
    let mut candidate = self.doc.clone();
    for (key, value) in snapshot.as_object().unwrap() {
      write_json(&mut candidate, &ROOT, key.clone().into(), value, false)?;
    }
    candidate.commit();
    validate(&candidate)?;
    self.doc = candidate;
    self.history.clear();
    self.peers.clear();
    Ok(())
  }
  pub fn merge_bytes(&mut self, bytes: &[u8]) -> Result<()> {
    let mut other = Self::from_bytes(bytes, None)?.doc;
    if self.doc.get(&ROOT, "documentId").map_err(err)?.map(|v| v.0)
      != other.get(&ROOT, "documentId").map_err(err)?.map(|v| v.0)
    {
      return Err("cannot merge different document identities".into());
    }
    let mut candidate = self.doc.clone();
    candidate.merge(&mut other).map_err(err)?;
    validate(&candidate)?;
    self.doc = candidate;
    Ok(())
  }
  pub fn apply(&mut self, command: Command) -> Result<()> {
    self.apply_inner(command, true)
  }
  fn apply_inner(&mut self, command: Command, validate_after: bool) -> Result<()> {
    if let Command::Batch { commands } = command {
      let mut engine = Self {
        doc: self.doc.clone(),
        peers: HashMap::new(),
        history: vec![],
      };
      for command in commands {
        engine.apply_inner(command, false)?;
      }
      if validate_after {
        validate(&engine.doc)?;
      }
      self.doc = engine.doc;
      self.history.push(Undo::Unsupported("batch undo is not implemented"));
      return Ok(());
    }
    // Invalid commands must not leave partially applied operations behind.
    let mut candidate = self.doc.clone();
    let undo = match command {
      Command::Set { path, value } => {
        writable_path(&path)?;
        let (parent, key) = parent_at(&candidate, &path)?;
        let previous = read_property(&candidate, &parent, path_prop(&candidate, &parent, &key)?)?.zip(
          candidate
            .get(&parent, path_prop(&candidate, &parent, &key)?)
            .map_err(err)?
            .map(|(_, id)| id),
        );
        write_json(
          &mut candidate,
          &parent,
          path_prop(&self.doc, &parent, &key)?,
          &value,
          false,
        )?;
        let written = candidate
          .get(&parent, path_prop(&candidate, &parent, &key)?)
          .map_err(err)?
          .ok_or("missing written value")?
          .1;
        Some(Undo::Set {
          parent,
          key,
          written,
          applied: value,
          previous,
        })
      }
      Command::Delete { path } => {
        writable_path(&path)?;
        let (parent, key) = parent_at(&candidate, &path)?;
        candidate
          .delete(&parent, path_prop(&candidate, &parent, &key)?)
          .map_err(err)?;
        // Deletion undo needs an operation-aware resurrection policy; fail rather than overwrite remote edits.
        Some(Undo::Unsupported("deletion undo requires operation-aware resurrection"))
      }
      Command::SpliceList {
        path,
        index,
        delete,
        values,
      } => {
        writable_path(&path)?;
        let object = object_at(&candidate, &path)?;
        if candidate.object_type(&object).map_err(err)? != ObjType::List {
          return Err("splice target is not a list".into());
        }
        let len = candidate.length(&object);
        if index > len || delete > len - index {
          return Err("list range outside document".into());
        }
        candidate
          .splice(
            &object,
            index,
            delete as isize,
            std::iter::empty::<automerge::hydrate::Value>(),
          )
          .map_err(err)?;
        for (offset, value) in values.iter().enumerate() {
          write_json(&mut candidate, &object, (index + offset).into(), value, true)?;
        }
        Some(Undo::Unsupported("list undo is not implemented"))
      }
      Command::Batch { .. } => unreachable!(),
      Command::SpliceText {
        path,
        index,
        delete,
        text,
      } => {
        writable_path(&path)?;
        let object = text_at(&candidate, &path)?;
        if candidate.object_type(&object).map_err(err)? != ObjType::Text {
          return Err("splice target is not rich text".into());
        }
        let current = candidate.text(&object).map_err(err)?;
        let units: Vec<u16> = current.encode_utf16().collect();
        if index > units.len() || delete > units.len() - index {
          return Err("text range outside document".into());
        }
        // Reject boundaries inside a surrogate pair instead of silently corrupting a character.
        utf16_boundary(&units, index)?;
        utf16_boundary(&units, index + delete)?;
        let removed = String::from_utf16(&units[index..index + delete]).map_err(err)?;
        let anchor = if index == units.len() {
          candidate
            .get_cursor(&object, automerge::CursorPosition::End, None)
            .map_err(err)?
        } else {
          candidate.get_cursor(&object, index, None).map_err(err)?
        };
        let before: HashSet<_> = (0..candidate.length(&object))
          .filter_map(|i| candidate.get(&object, i).ok().flatten().map(|v| v.1))
          .collect();
        candidate
          .splice_text(&object, index, delete as isize, &text)
          .map_err(err)?;
        let inserted = (0..candidate.length(&object))
          .filter_map(|i| candidate.get(&object, i).ok().flatten().map(|v| v.1))
          .filter(|id| !before.contains(id))
          .collect();
        let marks = self
          .doc
          .marks(&object)
          .map_err(err)?
          .into_iter()
          .filter_map(|mut mark| {
            let start = mark.start.max(index);
            let end = mark.end.min(index + delete);
            if start >= end {
              return None;
            }
            mark.start = start - index;
            mark.end = end - index;
            Some(mark)
          })
          .collect();
        Some(Undo::Text {
          object,
          inserted,
          removed,
          marks,
          anchor,
        })
      }
      Command::MarkText {
        path,
        start,
        end,
        name,
        value,
      } => {
        writable_path(&path)?;
        let object = text_at(&candidate, &path)?;
        if candidate.object_type(&object).map_err(err)? != ObjType::Text {
          return Err("mark target is not rich text".into());
        }
        let units: Vec<u16> = candidate.text(&object).map_err(err)?.encode_utf16().collect();
        if start > end || end > units.len() || name.is_empty() {
          return Err("invalid mark range or name".into());
        }
        utf16_boundary(&units, start)?;
        utf16_boundary(&units, end)?;
        if value.is_null() {
          candidate
            .unmark(&object, &name, start, end, ExpandMark::Both)
            .map_err(err)?;
        } else {
          candidate
            .mark(
              &object,
              Mark::new(name, value.to_string(), start, end),
              ExpandMark::Both,
            )
            .map_err(err)?;
        }
        Some(Undo::Unsupported("formatting undo is not implemented"))
      }
    };
    candidate.commit();
    if validate_after {
      validate(&candidate)?;
    }
    self.doc = candidate;
    if let Some(undo) = undo {
      self.history.push(undo);
    }
    Ok(())
  }
  pub fn undo_local(&mut self) -> Result<bool> {
    let Some(undo) = self.history.last().cloned() else {
      return Ok(false);
    };
    let mut candidate = self.doc.clone();
    match undo {
      Undo::Unsupported(reason) => return Err(reason.into()),
      Undo::Set {
        parent,
        key,
        written,
        applied,
        previous,
      } => {
        // Check the operation identity, not equality: a peer can write the same value.
        let values = candidate
          .get_all(&parent, path_prop(&candidate, &parent, &key)?)
          .map_err(err)?;
        if values.len() != 1
          || values[0].1 != written
          || read_property(&candidate, &parent, path_prop(&candidate, &parent, &key)?)? != Some(applied)
        {
          return Ok(false);
        }
        if let Some((previous, previous_id)) = previous {
          // The replaced object may have received hidden peer edits after replacement.
          let previous = if candidate.object_type(&previous_id).is_ok() {
            read_object(&candidate, &previous_id)?
          } else {
            previous
          };
          write_json(
            &mut candidate,
            &parent,
            path_prop(&self.doc, &parent, &key)?,
            &previous,
            false,
          )?;
        } else {
          candidate
            .delete(&parent, path_prop(&candidate, &parent, &key)?)
            .map_err(err)?;
        }
      }
      Undo::Text {
        object,
        inserted,
        removed,
        marks,
        anchor,
      } => {
        let mut indices = vec![];
        for i in 0..candidate.length(&object) {
          if candidate
            .get(&object, i)
            .map_err(err)?
            .is_some_and(|(_, id)| inserted.contains(&id))
          {
            indices.push(i);
          }
        }
        // Remove only locally inserted operation IDs, leaving interleaved peer characters intact.
        let mut ranges: Vec<(usize, usize)> = vec![];
        for i in indices {
          if let Some((start, len)) = ranges.last_mut()
            && *start + *len == i
          {
            *len += 1;
            continue;
          }
          ranges.push((i, 1));
        }
        for (start, len) in ranges.into_iter().rev() {
          candidate.splice_text(&object, start, len as isize, "").map_err(err)?;
        }
        if !removed.is_empty() {
          let index = candidate.get_cursor_position(&object, &anchor, None).map_err(err)?;
          candidate.splice_text(&object, index, 0, &removed).map_err(err)?;
          for mut mark in marks {
            mark.start += index;
            mark.end += index;
            candidate.mark(&object, mark, ExpandMark::None).map_err(err)?;
          }
        }
      }
    }
    candidate.commit();
    validate(&candidate)?;
    self.doc = candidate;
    self.history.pop();
    Ok(true)
  }
}

fn utf16_boundary(units: &[u16], i: usize) -> Result<()> {
  if i > 0 && i < units.len() && (0xd800..=0xdbff).contains(&units[i - 1]) && (0xdc00..=0xdfff).contains(&units[i]) {
    Err("text position splits a surrogate pair".into())
  } else {
    Ok(())
  }
}
fn writable_path(path: &[String]) -> Result<()> {
  match path.first().map(String::as_str) {
    Some("blocks" | "metadata") if path.len() > 1 => Ok(()),
    Some("rootId") if path.len() == 1 => Ok(()),
    _ => Err("commands may only edit blocks, metadata, or rootId".into()),
  }
}
fn parent_at(doc: &AutoCommit, path: &[String]) -> Result<(ObjId, String)> {
  let (key, parent) = path.split_last().ok_or("empty path")?;
  Ok((object_at(doc, parent)?, key.clone()))
}
fn path_prop(doc: &AutoCommit, object: &ObjId, key: &str) -> Result<Prop> {
  match doc.object_type(object).map_err(err)? {
    ObjType::List => key
      .parse::<usize>()
      .map(Prop::Seq)
      .map_err(|_| "list path segment must be an index".into()),
    ObjType::Map | ObjType::Table => Ok(key.into()),
    ObjType::Text => Err("cannot traverse into text by path".into()),
  }
}
fn object_at(doc: &AutoCommit, path: &[String]) -> Result<ObjId> {
  let mut object = ROOT;
  for key in path {
    object = match doc.get(&object, path_prop(doc, &object, key)?).map_err(err)? {
      Some((Value::Object(_), id)) => id,
      _ => return Err(format!("missing object at {}", path.join("/"))),
    };
  }
  Ok(object)
}
fn scalar_json(value: &ScalarValue) -> Result<Json> {
  Ok(match value {
    ScalarValue::Null => Json::Null,
    ScalarValue::Boolean(v) => json!(v),
    ScalarValue::Str(v) => json!(v.as_str()),
    ScalarValue::Int(v) => json!(v),
    ScalarValue::Uint(v) => json!(v),
    ScalarValue::F64(v) if v.is_finite() => json!(v),
    _ => return Err("unsupported scalar in checkpoint".into()),
  })
}
fn read_property(doc: &AutoCommit, obj: &ObjId, prop: Prop) -> Result<Option<Json>> {
  doc
    .get(obj, prop)
    .map_err(err)?
    .map(|(value, id)| match value {
      Value::Scalar(value) => scalar_json(&value),
      Value::Object(_) => read_object(doc, &id),
    })
    .transpose()
}
fn read_object(doc: &AutoCommit, obj: &ObjId) -> Result<Json> {
  match doc.object_type(obj).map_err(err)? {
    ObjType::Map | ObjType::Table => {
      for marker in ["$blocksuite:internal:text$", "affine:surface:text"] {
        if let Some((value, _)) = doc.get(obj, marker).map_err(err)?
          && (value.to_scalar() != Some(&ScalarValue::Boolean(true))
            || doc.length(obj) != 2
            || !matches!(
              doc.get(obj, "delta").map_err(err)?,
              Some((Value::Object(ObjType::Text), _))
            ))
        {
          return Err("invalid native rich text structure".into());
        }
      }
      let mut map = serde_json::Map::new();
      for key in doc.keys(obj) {
        map.insert(
          key.clone(),
          read_property(doc, obj, key.into())?.ok_or("missing map value")?,
        );
      }
      Ok(Json::Object(map))
    }
    ObjType::List => (0..doc.length(obj))
      .map(|i| read_property(doc, obj, i.into())?.ok_or("missing list value".into()))
      .collect::<Result<Vec<_>>>()
      .map(Json::Array),
    ObjType::Text => {
      let text = doc.text(obj).map_err(err)?;
      let units: Vec<u16> = text.encode_utf16().collect();
      let marks = doc.marks(obj).map_err(err)?;
      let mut boundaries = vec![0, units.len()];
      for m in &marks {
        boundaries.extend([m.start, m.end]);
      }
      boundaries.sort_unstable();
      boundaries.dedup();
      let mut delta = vec![];
      for pair in boundaries.windows(2) {
        if pair[0] == pair[1] {
          continue;
        }
        let mut attributes = serde_json::Map::new();
        for m in &marks {
          if m.start <= pair[0] && m.end >= pair[1] {
            let raw = scalar_json(&m.value)?;
            let decoded = raw
              .as_str()
              .and_then(|s| serde_json::from_str(s).ok())
              .ok_or("invalid encoded mark")?;
            attributes.insert(m.name.to_string(), decoded);
          }
        }
        let mut span = json!({"insert":String::from_utf16(&units[pair[0]..pair[1]]).map_err(err)?});
        if !attributes.is_empty() {
          span["attributes"] = Json::Object(attributes);
        }
        delta.push(span);
      }
      Ok(Json::Array(delta))
    }
  }
}
fn write_json(doc: &mut AutoCommit, parent: &ObjId, prop: Prop, value: &Json, insert: bool) -> Result<()> {
  let object_type = if value.is_object() {
    Some(ObjType::Map)
  } else if value.is_array() {
    Some(ObjType::List)
  } else {
    None
  };
  if let Some(kind) = object_type {
    let object = if insert {
      let Prop::Seq(i) = prop else {
        return Err("insert needs list index".into());
      };
      doc.insert_object(parent, i, kind).map_err(err)?
    } else {
      doc.put_object(parent, prop, kind).map_err(err)?
    };
    match kind {
      ObjType::Map => {
        let marker = ["$blocksuite:internal:text$", "affine:surface:text"]
          .iter()
          .find(|key| value.get(**key) == Some(&Json::Bool(true)));
        if let Some(marker) = marker {
          if value.as_object().unwrap().len() != 2 {
            return Err("rich text marker has extra fields".into());
          }
          doc.put(&object, *marker, true).map_err(err)?;
          let text_obj = doc.put_object(&object, "delta", ObjType::Text).map_err(err)?;
          write_text(doc, &text_obj, &value["delta"])?;
        } else {
          for (key, value) in value.as_object().unwrap() {
            write_json(doc, &object, key.clone().into(), value, false)?;
          }
        }
      }
      ObjType::List => {
        for (i, value) in value.as_array().unwrap().iter().enumerate() {
          write_json(doc, &object, i.into(), value, true)?;
        }
      }
      _ => unreachable!(),
    }
  } else {
    let scalar = match value {
      Json::Null => ScalarValue::Null,
      Json::Bool(v) => ScalarValue::Boolean(*v),
      Json::String(v) => ScalarValue::Str(v.as_str().into()),
      Json::Number(v) => {
        if let Some(v) = v.as_i64() {
          ScalarValue::Int(v)
        } else if let Some(v) = v.as_u64() {
          ScalarValue::Uint(v)
        } else {
          ScalarValue::F64(v.as_f64().ok_or("invalid number")?)
        }
      }
      _ => unreachable!(),
    };
    if insert {
      let Prop::Seq(i) = prop else {
        return Err("insert needs list index".into());
      };
      doc.insert(parent, i, scalar).map_err(err)?;
    } else {
      doc.put(parent, prop, scalar).map_err(err)?;
    }
  }
  Ok(())
}
fn text_at(doc: &AutoCommit, path: &[String]) -> Result<ObjId> {
  let object = object_at(doc, path)?;
  if doc.object_type(&object).map_err(err)? == ObjType::Text {
    return Ok(object);
  }
  for marker in ["$blocksuite:internal:text$", "affine:surface:text"] {
    if doc
      .get(&object, marker)
      .map_err(err)?
      .is_some_and(|(v, _)| v.to_scalar() == Some(&ScalarValue::Boolean(true)))
    {
      return match doc.get(&object, "delta").map_err(err)? {
        Some((Value::Object(ObjType::Text), id)) => Ok(id),
        _ => Err("invalid text marker".into()),
      };
    }
  }
  Err("path is not rich text".into())
}
fn write_text(doc: &mut AutoCommit, object: &ObjId, delta: &Json) -> Result<()> {
  let spans = delta.as_array().ok_or("text marker must contain delta array")?;
  let mut offset = 0;
  for span in spans {
    let text = span
      .get("insert")
      .and_then(Json::as_str)
      .ok_or("embedded or non-string text insert unsupported")?;
    if span
      .as_object()
      .is_none_or(|s| s.keys().any(|k| k != "insert" && k != "attributes"))
    {
      return Err("unsupported text delta fields".into());
    }
    doc.splice_text(object, offset, 0, text).map_err(err)?;
    let end = offset + text.encode_utf16().count();
    if let Some(attributes) = span.get("attributes") {
      for (name, value) in attributes.as_object().ok_or("text attributes must be an object")? {
        if name.is_empty() || value.is_null() {
          return Err("invalid initial text mark".into());
        }
        doc
          .mark(
            object,
            Mark::new(name.clone(), value.to_string(), offset, end),
            ExpandMark::None,
          )
          .map_err(err)?;
      }
    }
    offset = end;
  }
  Ok(())
}
fn validate(doc: &AutoCommit) -> Result<()> {
  let schemas = doc.get_all(&ROOT, "schemaVersion").map_err(err)?;
  if schemas.len() != 1 {
    return Err("checkpoint has missing or conflicting schema version".into());
  }
  let identities = doc.get_all(&ROOT, "documentId").map_err(err)?;
  if identities.len() != 1 || !matches!(identities[0].0.to_scalar(), Some(ScalarValue::Str(_))) {
    return Err("checkpoint has missing or conflicting document identity".into());
  }
  validate_snapshot(&read_object(doc, &ROOT)?)
}
fn validate_snapshot(snapshot: &Json) -> Result<()> {
  let map = snapshot.as_object().ok_or("checkpoint root must be a map")?;
  if map
    .keys()
    .any(|k| !["schemaVersion", "documentId", "rootId", "metadata", "blocks"].contains(&k.as_str()))
  {
    return Err("unsupported checkpoint root field".into());
  }
  if snapshot["schemaVersion"] != json!(2) {
    return Err("unsupported document schema; expected version 2".into());
  }
  let identity = snapshot["documentId"]
    .as_str()
    .filter(|s| !s.is_empty())
    .ok_or("documentId must be a nonempty string")?;
  if snapshot["metadata"]
    .get("id")
    .is_some_and(|id| id.as_str() != Some(identity))
  {
    return Err("metadata.id must equal documentId".into());
  }
  if !snapshot["metadata"].is_object() || !snapshot["blocks"].is_object() {
    return Err("metadata and blocks must be maps".into());
  }
  if !map.contains_key("rootId") || (!snapshot["rootId"].is_null() && !snapshot["rootId"].is_string()) {
    return Err("rootId must be a string or null".into());
  }
  for (id, block) in snapshot["blocks"].as_object().unwrap() {
    if id.is_empty()
      || !block.as_object().is_some_and(|map| {
        map.contains_key("parentId")
          && map
            .keys()
            .all(|key| ["id", "flavour", "version", "parentId", "children", "props"].contains(&key.as_str()))
      })
      || block.get("version").is_some_and(|version| version.as_u64().is_none())
      || block["id"].as_str() != Some(id)
      || !block["flavour"].is_string()
      || !block["props"].is_object()
      || !block["children"].is_array()
      || (!block["parentId"].is_null() && !block["parentId"].is_string())
    {
      return Err(format!("invalid block {id}"));
    }
    if block["children"].as_array().unwrap().iter().any(|v| !v.is_string()) {
      return Err(format!("invalid children in block {id}"));
    }
  }
  validate_tree(snapshot)
}
fn validate_identity(id: &str, actor: Option<&str>) -> Result<()> {
  if id.is_empty() {
    return Err("documentId must not be empty".into());
  }
  if actor.is_some_and(str::is_empty) {
    return Err("actor ID must not be empty".into());
  }
  Ok(())
}
fn validate_tree(snapshot: &Json) -> Result<()> {
  let blocks = snapshot["blocks"].as_object().ok_or("blocks must be a map")?;
  let Some(root) = snapshot["rootId"].as_str() else {
    return if blocks.is_empty() {
      Ok(())
    } else {
      Err("nonempty document requires rootId".into())
    };
  };
  let root_block = blocks.get(root).ok_or("rootId references a missing block")?;
  if !root_block["parentId"].is_null() {
    return Err("root block must have null parentId".into());
  }
  let mut visited = HashSet::new();
  let mut pending = vec![root];
  while let Some(id) = pending.pop() {
    if !visited.insert(id) {
      return Err("block tree has cycles or duplicate child references".into());
    }
    let block = blocks.get(id).ok_or("child references a missing block")?;
    for child in block["children"].as_array().ok_or("children must be a list")? {
      let child = child.as_str().ok_or("child ID must be string")?;
      let child_block = blocks.get(child).ok_or("child references a missing block")?;
      if child_block["parentId"].as_str() != Some(id) {
        return Err("child parentId disagrees with parent children".into());
      }
      pending.push(child);
    }
  }
  if visited.len() != blocks.len() {
    return Err("block tree contains unreachable blocks".into());
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  fn path(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| (*s).into()).collect()
  }
  fn fixture() -> Json {
    json!({"schemaVersion":2,"documentId":"doc","rootId":"root","metadata":{"title":"Fixture","tags":["one"],"custom":{"flags":[true,null]}},"blocks":{
        "root":{"id":"root","flavour":"affine:page","version":2,"parentId":null,"children":["text","surface"],"props":{"title":{"$blocksuite:internal:text$":true,"delta":[]}}},
        "text":{"id":"text","flavour":"affine:paragraph","version":1,"parentId":"root","children":[],"props":{"text":{"$blocksuite:internal:text$":true,"delta":[{"insert":"Hello","attributes":{"bold":true,"link":{"href":"https://example.com"}}}]},"boxed":{"$blocksuite:internal:native$":true,"value":{"nested":[1,2]}}}},
        "surface":{"id":"surface","flavour":"affine:surface","version":5,"parentId":"root","children":[],"props":{"elements":{"shape/ arbitrary id":{"id":"shape/ arbitrary id","xywh":"[0,0,100,100]","fillColor":"red","text":{"affine:surface:text":true,"delta":[{"insert":"Canvas"}]}},"connector":{"id":"connector","source":{"id":"shape/ arbitrary id"},"target":{"id":"text"}}}}}
    }})
  }
  fn seeded() -> DocumentEngine {
    let mut d = DocumentEngine::create("doc", Some("seed")).unwrap();
    d.import(&fixture()).unwrap();
    d
  }
  fn replicas() -> (DocumentEngine, DocumentEngine) {
    let bytes = seeded().save();
    (
      DocumentEngine::from_bytes(&bytes, Some("alice")).unwrap(),
      DocumentEngine::from_bytes(&bytes, Some("bob")).unwrap(),
    )
  }
  fn converge(a: &mut DocumentEngine, b: &mut DocumentEngine) {
    let a_bytes = a.save();
    let b_bytes = b.save();
    a.merge_bytes(&b_bytes).unwrap();
    b.merge_bytes(&a_bytes).unwrap();
    assert_eq!(a.snapshot_json().unwrap(), b.snapshot_json().unwrap());
  }
  fn text(d: &DocumentEngine) -> String {
    let snap = d.snapshot_json().unwrap();
    snap["blocks"]["text"]["props"]["text"]["delta"]
      .as_array()
      .unwrap()
      .iter()
      .map(|v| v["insert"].as_str().unwrap())
      .collect()
  }
  #[test]
  fn import_fidelity_and_checkpoint_reload() {
    let mut d = seeded();
    assert_eq!(d.snapshot_json().unwrap(), fixture());
    let loaded = DocumentEngine::from_bytes(&d.save(), Some("fresh")).unwrap();
    assert_eq!(loaded.snapshot_json().unwrap(), fixture());
  }
  #[test]
  fn concurrent_text_and_arbitrary_format_marks() {
    let (mut a, mut b) = replicas();
    let p = path(&["blocks", "text", "props", "text"]);
    a.apply(Command::SpliceText {
      path: p.clone(),
      index: 5,
      delete: 0,
      text: " Alice".into(),
    })
    .unwrap();
    b.apply(Command::SpliceText {
      path: p.clone(),
      index: 0,
      delete: 0,
      text: "Bob ".into(),
    })
    .unwrap();
    b.apply(Command::MarkText {
      path: p,
      start: 0,
      end: 3,
      name: "color".into(),
      value: json!({"theme":"accent","levels":[1,2]}),
    })
    .unwrap();
    converge(&mut a, &mut b);
    assert!(text(&a).contains("Bob Hello Alice"));
    let snap = a.snapshot_json().unwrap();
    assert!(snap.to_string().contains("accent"));
  }
  #[test]
  fn concurrent_canvas_fields_preserved() {
    let (mut a, mut b) = replicas();
    a.apply(Command::Set {
      path: path(&["blocks", "surface", "props", "elements", "shape/ arbitrary id", "xywh"]),
      value: json!("[12,34,100,100]"),
    })
    .unwrap();
    b.apply(Command::Set {
      path: path(&[
        "blocks",
        "surface",
        "props",
        "elements",
        "shape/ arbitrary id",
        "fillColor",
      ]),
      value: json!("blue"),
    })
    .unwrap();
    converge(&mut a, &mut b);
    let snap = a.snapshot_json().unwrap();
    let shape = &snap["blocks"]["surface"]["props"]["elements"]["shape/ arbitrary id"];
    assert_eq!(shape["fillColor"], json!("blue"));
    assert_eq!(shape["xywh"], json!("[12,34,100,100]"));
  }
  #[test]
  fn text_undo_preserves_interleaved_peer_insert() {
    let (mut a, mut b) = replicas();
    let p = path(&["blocks", "text", "props", "text"]);
    a.apply(Command::SpliceText {
      path: p.clone(),
      index: 2,
      delete: 0,
      text: "LOCAL".into(),
    })
    .unwrap();
    b.merge_bytes(&a.save()).unwrap();
    b.apply(Command::SpliceText {
      path: p,
      index: 4,
      delete: 0,
      text: "PEER".into(),
    })
    .unwrap();
    a.merge_bytes(&b.save()).unwrap();
    assert!(a.undo_local().unwrap());
    assert_eq!(text(&a), "HePEERllo");
    converge(&mut a, &mut b);
  }
  #[test]
  fn text_undo_emoji_preserves_remote_insert() {
    let (mut a, mut b) = replicas();
    let p = path(&["blocks", "text", "props", "text"]);
    a.apply(Command::SpliceText {
      path: p.clone(),
      index: 2,
      delete: 0,
      text: "🙂".into(),
    })
    .unwrap();
    b.apply(Command::SpliceText {
      path: p,
      index: 5,
      delete: 0,
      text: "REMOTE".into(),
    })
    .unwrap();
    a.merge_bytes(&b.save()).unwrap();
    assert!(a.undo_local().unwrap());
    assert_eq!(text(&a), "HelloREMOTE");
  }
  #[test]
  fn field_undo_does_not_overwrite_remote_operation() {
    let (mut a, mut b) = replicas();
    let p = path(&["metadata", "title"]);
    a.apply(Command::Set {
      path: p.clone(),
      value: json!("same"),
    })
    .unwrap();
    b.merge_bytes(&a.save()).unwrap();
    b.apply(Command::Set {
      path: p.clone(),
      value: json!("different"),
    })
    .unwrap();
    b.apply(Command::Set {
      path: p,
      value: json!("same"),
    })
    .unwrap();
    a.merge_bytes(&b.save()).unwrap();
    assert!(!a.undo_local().unwrap());
    assert_eq!(a.snapshot_json().unwrap()["metadata"]["title"], json!("same"));
  }
  #[test]
  fn replacing_object_undo_does_not_discard_peer_nested_edit() {
    let (mut a, mut b) = replicas();
    a.apply(Command::Set {
      path: path(&["metadata", "custom"]),
      value: json!({"flags":[],"mine":true}),
    })
    .unwrap();
    b.merge_bytes(&a.save()).unwrap();
    b.apply(Command::Set {
      path: path(&["metadata", "custom", "peer"]),
      value: json!(true),
    })
    .unwrap();
    a.merge_bytes(&b.save()).unwrap();
    assert!(!a.undo_local().unwrap());
    assert_eq!(a.snapshot_json().unwrap()["metadata"]["custom"]["peer"], json!(true));
  }
  #[test]
  fn independent_list_inserts_converge() {
    let (mut a, mut b) = replicas();
    let p = path(&["metadata", "tags"]);
    a.apply(Command::SpliceList {
      path: p.clone(),
      index: 1,
      delete: 0,
      values: vec![json!("alice")],
    })
    .unwrap();
    b.apply(Command::SpliceList {
      path: p,
      index: 1,
      delete: 0,
      values: vec![json!("bob")],
    })
    .unwrap();
    converge(&mut a, &mut b);
    let snap = a.snapshot_json().unwrap();
    let tags = snap["metadata"]["tags"].as_array().unwrap();
    assert_eq!(tags.len(), 3);
    assert!(tags.contains(&json!("alice")) && tags.contains(&json!("bob")));
  }
  #[test]
  fn invalid_commands_and_import_are_atomic() {
    let mut d = seeded();
    let original = d.save();
    let p = path(&["blocks", "text", "props", "text"]);
    assert!(
      d.apply(Command::SpliceText {
        path: p,
        index: 80,
        delete: 0,
        text: "bad".into()
      })
      .is_err()
    );
    assert_eq!(d.save(), original);
    assert!(
      d.apply(Command::Set {
        path: path(&["schemaVersion"]),
        value: json!(99)
      })
      .is_err()
    );
    let mut empty = DocumentEngine::create("doc", Some("other")).unwrap();
    let original = empty.save();
    let mut invalid = fixture();
    invalid["blocks"]["text"]["props"]["text"]["delta"] = json!([{"insert":{"image":"bad"}}]);
    assert!(empty.import(&invalid).is_err());
    assert_eq!(empty.save(), original);
  }
  #[test]
  fn rejects_other_document_and_unknown_schema() {
    let mut d = seeded();
    let other = DocumentEngine::create("other", Some("bob")).unwrap().save();
    assert!(d.merge_bytes(&other).is_err());
    let mut invalid = fixture();
    invalid["schemaVersion"] = json!(3);
    assert!(validate_snapshot(&invalid).is_err());
  }
  #[test]
  fn unsupported_undo_is_explicit() {
    let mut d = seeded();
    d.apply(Command::MarkText {
      path: path(&["blocks", "text", "props", "text"]),
      start: 0,
      end: 1,
      name: "italic".into(),
      value: json!(true),
    })
    .unwrap();
    assert_eq!(d.undo_local().unwrap_err(), "formatting undo is not implemented");
  }
  #[test]
  fn deleted_text_undo_restores_original_formatting() {
    let mut d = seeded();
    d.apply(Command::SpliceText {
      path: path(&["blocks", "text", "props", "text"]),
      index: 1,
      delete: 3,
      text: "".into(),
    })
    .unwrap();
    assert_eq!(text(&d), "Ho");
    assert!(d.undo_local().unwrap());
    assert_eq!(d.snapshot_json().unwrap(), fixture());
  }
  #[test]
  fn restore_replaced_map_includes_hidden_peer_edits() {
    let (mut a, mut b) = replicas();
    a.apply(Command::Set {
      path: path(&["metadata", "custom"]),
      value: json!({"replacement":true}),
    })
    .unwrap();
    b.apply(Command::Set {
      path: path(&["metadata", "custom", "peer"]),
      value: json!(true),
    })
    .unwrap();
    a.merge_bytes(&b.save()).unwrap();
    assert!(a.undo_local().unwrap());
    assert_eq!(a.snapshot_json().unwrap()["metadata"]["custom"]["peer"], json!(true));
  }
  #[test]
  fn native_sync_protocol_converges() {
    let (mut a, mut b) = replicas();
    a.apply(Command::Set {
      path: path(&["metadata", "title"]),
      value: json!("Alice"),
    })
    .unwrap();
    b.apply(Command::Set {
      path: path(&["metadata", "custom", "peer"]),
      value: json!(true),
    })
    .unwrap();
    for _ in 0..10 {
      let mut sent = false;
      if let Some(bytes) = a.generate_sync_message("bob") {
        b.receive_sync_message("alice", &bytes).unwrap();
        sent = true;
      }
      if let Some(bytes) = b.generate_sync_message("alice") {
        a.receive_sync_message("bob", &bytes).unwrap();
        sent = true;
      }
      if !sent {
        break;
      }
    }
    assert_eq!(a.snapshot_json().unwrap(), b.snapshot_json().unwrap());
    assert_eq!(a.snapshot_json().unwrap()["metadata"]["title"], json!("Alice"));
    assert_eq!(a.snapshot_json().unwrap()["metadata"]["custom"]["peer"], json!(true));
  }
  #[test]
  fn undo_unsupported_barrier_remains_until_implemented() {
    let mut d = seeded();
    let p = path(&["blocks", "text", "props", "text"]);
    d.apply(Command::SpliceText {
      path: p.clone(),
      index: 5,
      delete: 0,
      text: "LOCAL".into(),
    })
    .unwrap();
    d.apply(Command::MarkText {
      path: p,
      start: 5,
      end: 10,
      name: "bold".into(),
      value: json!(true),
    })
    .unwrap();
    let checkpoint = d.save();
    assert!(d.undo_local().is_err());
    assert!(d.undo_local().is_err());
    assert_eq!(d.save(), checkpoint);
  }
  #[test]
  fn identity_and_graph_validation_rejects_atomic_changes() {
    assert!(DocumentEngine::create("", Some("a")).is_err());
    assert!(DocumentEngine::create("doc", Some("")).is_err());
    for mutate in [
      |v: &mut Json| {
        v.as_object_mut().unwrap().remove("documentId");
      },
      |v: &mut Json| {
        v["documentId"] = json!("");
      },
      |v: &mut Json| {
        v["documentId"] = json!("wrong");
      },
      |v: &mut Json| {
        v["blocks"]["text"].as_object_mut().unwrap().remove("parentId");
      },
      |v: &mut Json| {
        v["rootId"] = json!("missing");
      },
      |v: &mut Json| {
        v["blocks"]["root"]["children"] = json!(["text", "text", "surface"]);
      },
      |v: &mut Json| {
        v["blocks"]["text"]["parentId"] = json!("surface");
      },
      |v: &mut Json| {
        v["metadata"]["id"] = json!("different");
      },
    ] {
      let mut d = DocumentEngine::create("doc", Some("a")).unwrap();
      let checkpoint = d.save();
      let mut value = fixture();
      mutate(&mut value);
      assert!(d.import(&value).is_err());
      assert_eq!(d.save(), checkpoint);
    }
    let mut d = seeded();
    let checkpoint = d.save();
    for command in [
      Command::Set {
        path: path(&["rootId"]),
        value: json!("missing"),
      },
      Command::Delete {
        path: path(&["blocks", "text"]),
      },
      Command::Set {
        path: path(&["metadata", "id"]),
        value: json!("wrong"),
      },
    ] {
      assert!(d.apply(command).is_err());
      assert_eq!(d.save(), checkpoint);
    }
  }
  #[test]
  fn batch_can_create_and_reparent_block_without_invalid_intermediate_tree() {
    let mut d = seeded();
    d.apply(Command::Batch { commands:vec![
      Command::Set { path:path(&["blocks","new"]),value:json!({"id":"new","flavour":"affine:paragraph","parentId":"root","children":[],"props":{"text":{"$blocksuite:internal:text$":true,"delta":[]}}}) },
      Command::SpliceList { path:path(&["blocks","root","children"]),index:2,delete:0,values:vec![json!("new")] },
    ] }).unwrap();
    d.apply(Command::Batch {
      commands: vec![
        Command::SpliceList {
          path: path(&["blocks", "root", "children"]),
          index: 2,
          delete: 1,
          values: vec![],
        },
        Command::Set {
          path: path(&["blocks", "new", "parentId"]),
          value: json!("text"),
        },
        Command::SpliceList {
          path: path(&["blocks", "text", "children"]),
          index: 0,
          delete: 0,
          values: vec![json!("new")],
        },
      ],
    })
    .unwrap();
    assert_eq!(d.snapshot_json().unwrap()["blocks"]["new"]["parentId"], json!("text"));
  }
  #[test]
  fn divergent_tree_merge_rejection_preserves_active_checkpoint() {
    let (mut a, mut b) = replicas();
    a.apply(Command::Batch {
      commands: vec![
        Command::SpliceList {
          path: path(&["blocks", "root", "children"]),
          index: 0,
          delete: 1,
          values: vec![],
        },
        Command::Set {
          path: path(&["blocks", "text", "parentId"]),
          value: json!("surface"),
        },
        Command::SpliceList {
          path: path(&["blocks", "surface", "children"]),
          index: 0,
          delete: 0,
          values: vec![json!("text")],
        },
      ],
    })
    .unwrap();
    b.apply(Command::Batch {
      commands: vec![
        Command::SpliceList {
          path: path(&["blocks", "root", "children"]),
          index: 1,
          delete: 1,
          values: vec![],
        },
        Command::Set {
          path: path(&["blocks", "surface", "parentId"]),
          value: json!("text"),
        },
        Command::SpliceList {
          path: path(&["blocks", "text", "children"]),
          index: 0,
          delete: 0,
          values: vec![json!("surface")],
        },
      ],
    })
    .unwrap();
    let checkpoint = a.save();
    assert!(a.merge_bytes(&b.save()).is_err());
    assert_eq!(a.save(), checkpoint);
  }
}
