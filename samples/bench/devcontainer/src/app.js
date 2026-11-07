const notes = [];
notes.push({ text: 'Write the README', done: true });
for (const n of notes) console.log(`${n.done ? '[x]' : '[ ]'} ${n.text}`);
