import functions_framework
from google.cloud import firestore
import json
import os

db = firestore.Client()
CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'teams_config.json')

# Пароль тепер береться з налаштувань середовища (Environment Variables)
# Або використовуємо дефолтний, якщо змінна не задана
ADMIN_KEY = os.environ.get('ADMIN_PASSWORD', '12345')

def get_allowed_teams():
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get('allowed_teams', [])
    except:
        return ["Команда-1", "Команда-2", "Команда-3", "Команда-4", "Команда-5", "Команда-6"]

@functions_framework.http
def manage_leaderboard(request):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    }
    if request.method == 'OPTIONS': return ('', 204, headers)

    allowed_teams = get_allowed_teams()

    if request.method == 'GET':
        try:
            state_doc = db.collection('settings').document('game_state').get()
            game_status = state_doc.to_dict().get('status', 'waiting') if state_doc.exists else 'waiting'
            
            teams_data = []
            for name in allowed_teams:
                t_ref = db.collection('teams').document(name)
                t_data = t_ref.get().to_dict() or {"total_score": 0}
                members = [{"nick": m.id, "status": m.to_dict().get('status'), "score": m.to_dict().get('best_score', 0)} 
                        for m in t_ref.collection('members').stream()]
                teams_data.append({"name": name, "total_score": t_data.get('total_score', 0), "members": members})

            return (json.dumps({"teams": teams_data, "game_status": game_status, "allowed_teams": allowed_teams}), 200, headers)
        except Exception as e:
            print(f"Помилка Firestore: {e}")
            # ГАРАНТОВАНО повертаємо порожню структуру, щоб JS не впав
            return (json.dumps({
                "players": [], 
                "teams": [], 
                "allowed_teams": get_allowed_teams(),
                "game_status": "waiting"
            }), 200, headers)


    if request.method == 'POST':
        data = request.get_json(silent=True)
        action, nick, team_name = data.get('action'), data.get('nick'), data.get('team')
        t_ref = db.collection('teams').document(team_name)
        m_ref = t_ref.collection('members').document(nick)

        if action == 'join':
            # ПЕРЕВІРКА: чи є вже такий нік за цим столом
            if m_ref.get().exists:
                return (json.dumps({"error": "Цей нікнейм вже зайнятий за цим столом!"}), 409, headers)
            
            m_docs = list(t_ref.collection('members').stream())
            if len(m_docs) >= 6:
                return (json.dumps({"error": "Стіл заповнений!"}), 403, headers)
            
            m_ref.set({"status": "joined", "best_score": 0})
            return (json.dumps({"status": "ok"}), 200, headers)

        if action == 'leave':
            # Учень повертається в меню — видаляємо його зі столу
            m_ref.delete()
            return (json.dumps({"status": "left"}), 200, headers)

        if action == 'finalize':
            score = int(data.get('score', 0))
            old_best = m_ref.get().to_dict().get('best_score', 0) if m_ref.get().exists else 0
            if score > old_best:
                t_ref.set({'total_score': firestore.Increment(score - old_best)}, merge=True)
                m_ref.update({'best_score': score})
            m_ref.update({'status': 'finished'})
            db.collection('leaderboard').add({'nick': nick, 'score': score, 'team': team_name, 'timestamp': firestore.SERVER_TIMESTAMP})
            return (json.dumps({"status": "ok"}), 200, headers)

    if request.method == 'PUT':
        if request.headers.get('X-Admin-Key') != ADMIN_KEY:
            return ("Unauthorized", 401, headers)
        
        cmd = request.get_json().get('command')
        if cmd == 'start_game':
            db.collection('settings').document('game_state').set({"status": "started"})
        elif cmd == 'reset_game':
            # ПРАВИЛЬНИЙ RESET: очищення всіх документів у teams та leaderboard
            db.collection('settings').document('game_state').set({"status": "waiting"})
            for name in allowed_teams:
                t_ref = db.collection('teams').document(name)
                # Видаляємо підколекцію members
                for m in t_ref.collection('members').stream(): m.reference.delete()
                t_ref.delete()
            return (json.dumps({"status": "reset_complete"}), 200, headers)
        
        return (json.dumps({"status": "ok"}), 200, headers)