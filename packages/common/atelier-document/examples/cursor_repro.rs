use automerge::{AutoCommit, MoveCursor, ObjType, ROOT, ReadDoc, transaction::Transactable};
fn main() {
  let mut doc = AutoCommit::new();
  let text = doc.put_object(ROOT, "text", ObjType::Text).unwrap();
  doc.splice_text(&text, 0, 0, "Hello").unwrap();
  doc.commit();
  let before = std::env::args().any(|arg| arg == "before");
  let movement = if before { MoveCursor::Before } else { MoveCursor::After };
  let cursor = doc.get_cursor_moving(&text, 4, None, movement).unwrap();
  doc.splice_text(&text, 4, 1, "").unwrap();
  doc.commit();
  let position = doc.get_cursor_position(&text, &cursor, None).unwrap();
  assert_eq!(position, if before { 3 } else { 4 });
  println!("{position}");
}
