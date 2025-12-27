require('dotenv').config();
const supabase = require('./lib/supabase-client');

async function check() {
  const { data, error } = await supabase
    .from('marketplace_agents')
    .select('slug, name, brain_config, tags, created_at')
    .ilike('name', '%pirate%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log('Pirate agents found:', data?.length || 0);
  if (data) {
    data.forEach(a => {
      console.log('---');
      console.log('Slug:', a.slug);
      console.log('Name:', a.name);
      console.log('Tags:', a.tags);
      console.log('Has brain_config:', !!a.brain_config);
      console.log('Has systemPrompt:', !!a.brain_config?.systemPrompt);
      if (a.brain_config?.systemPrompt) {
        console.log('SystemPrompt preview:', a.brain_config.systemPrompt.substring(0, 100));
      }
      console.log('Created:', a.created_at);
    });
  }
}
check();
