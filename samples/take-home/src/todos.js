const items = [];
let nextId = 1;

function list() {
  return items;
}

function add(title) {
  const todo = { id: nextId++, title, done: false };
  items.push(todo);
  return todo;
}

module.exports = { list, add };
