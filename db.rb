require 'net/http'
require 'awesome_print'
require 'csv'
require 'pg'
require 'pry'

# CWP_TASKS_SHEET_NAME = 'CWP - 3rd Party'
NAWSC_SHEET_ID = '1SHSRxATYjYQTuf5zdbBP2Q0KZvQl7kLo6WhSBNTwyFQ'
# GSHEETS_URL = 'https://docs.google.com/spreadsheets/d/'
GID_CWP=0
GID_AQUA=1752677248
GID_FIRE=1340353512
CWP_PROJECT_ID = 'd6e47b1d-509e-4401-9f62-dd042c4602fe'
AQUA_PROJECT_ID = '28bdccd2-f9c7-4c1f-bf9a-15777d4cc010'
NAFISC_PROJECT_ID = '4bf4a22e-2531-4279-9e8c-4dae672284f3'

PROJECTS_INFO_MAP = {
  "CWP"=> {"GID" => GID_CWP, "PROJECT_ID"=> CWP_PROJECT_ID },
  "AQUA" => {"GID" => GID_AQUA, "PROJECT_ID"=> AQUA_PROJECT_ID},
  "FIRE" => {"GID" => GID_FIRE, "PROJECT_ID"=> NAFISC_PROJECT_ID}
}

CURRENT_PROJECT_INFO = PROJECTS_INFO_MAP[ARGV[0]] || PROJECTS_INFO_MAP["FIRE"]

FINAL_URL = "https://docs.google.com/spreadsheets/d/#{NAWSC_SHEET_ID}/export?format=csv&gid=#{CURRENT_PROJECT_INFO["GID"]}"

FIELD_AMOUNT = 13



puts FINAL_URL
response = Net::HTTP.get_response(  URI(FINAL_URL) )
# ap response.to_hash

if response.is_a?(Net::HTTPRedirection)
  redirected_uri = URI(response['location'])
  csv = Net::HTTP.get(redirected_uri)
else
  csv = response.body
end


csv_row_array = []
# .to_a on CSV::Table returns [headers_array, *data_rows], so element 0 = headers (sheet row 1),
# element 1 = first data row (sheet row 2). After .drop(2), index 0 = sheet row 3.
# Adjust the +3 offset below if your sheet has a different layout.
CSV.parse(csv.to_s, headers: true).to_a.drop(2).each_with_index do |row, i|
    if(row.all?(&:nil?))
        ap "Skipping empty row"
    else
        csv_row_array << [row, i + 3]
    end
end

# ap csv_row_array
def parse_date(str)
  return nil if str.nil? || str.strip.empty?
  Date.strptime(str.strip, '%m/%d/%Y').strftime('%Y-%m-%d')
rescue ArgumentError
  nil  # if date is malformed, just store nil instead of crashing
end

# [ 1] "ticket id", Primary Key 255
# [ 2] "Date", Reported Date
# [ 3] "Reported By", Reported By 255
# [ 4] "Tab / Section", Affected Area on Portal 255
# [ 5] "Issue Description", Description
# [ 6] "Due Date", Due Date
# [ 7] "Level", Priority
# [ 8] "Status", Status
# [ 9] "Assigned To", Assigned To 255
# [ 10] "Notes", Notes 
# [ 11] "Resolution Date", Completion Date

flattened_values = csv_row_array.flat_map do |(row, sheet_row)|
   values = row.first(12)
   # 0, 2, 3, 8
   values[2] = 'Invalid value' if values[2]&.length.to_i > 255
   values[3] = 'Invalid value' if values[3]&.length.to_i > 255
   values[8] = 'Invalid value' if values[8]&.length.to_i > 255
   values[1] = parse_date(values[1])
   values[5] = parse_date(values[5])
   values[10] = parse_date(values[10])
   values[11] = CURRENT_PROJECT_INFO["PROJECT_ID"]
   values << sheet_row
   values
end

# ap flattened_values.first(24)

param_placeholders = (flattened_values.length/FIELD_AMOUNT).times.map do |i| 
  start = i*FIELD_AMOUNT+1
  sub_params = (start..start+FIELD_AMOUNT-1).map { |range_num| "$#{range_num}" }
  "(" + sub_params.join(',') + ")"
end

# ap "param_placeholders" + param_placeholders.class.to_s


conn = PG.connect(dbname: 'zippy', user: 'amana')

ap csv_row_array.first(20)

dml_string = "INSERT INTO TASKS (
sheet_id,
created_at,
reporter,
component,
description,
due_date,
priority,
status,
assignee,
notes,
completed_at,
project_id,
sheet_row) VALUES #{param_placeholders.join(',')}
ON CONFLICT (sheet_id) DO UPDATE SET
  created_at   = EXCLUDED.created_at,
  reporter     = EXCLUDED.reporter,
  component    = EXCLUDED.component,
  description  = EXCLUDED.description,
  due_date     = EXCLUDED.due_date,
  priority     = EXCLUDED.priority,
  status       = EXCLUDED.status,
  assignee     = EXCLUDED.assignee,
  notes        = EXCLUDED.notes,
  completed_at = EXCLUDED.completed_at,
  project_id   = EXCLUDED.project_id,
  sheet_row    = EXCLUDED.sheet_row"

# conn.exec_params('\set VERBOSITY verbose')
# ap dml_string


conn.exec_params(dml_string, flattened_values);




# conn.exec("INSERT INTO TASKS (
# created_at, 0
# reporter, 1
# component, 2
# description, 3 
# due_date, 4
# priority, 5
# status, 6
# assignee,7 
# notes, 8
# projection_id, 9
# completed_at, 10
# sheet_id 11 VALUES #{flattened_values}")


# INSERT INTO TASKS (
# created_at, 
# reporter, 
# component, 
# description, 
# due_date, 
# priority, 
# status, 
# assignee, 
# notes, 
# projection_id
# completed_at, 
# sheet_id
# ) VALUES (1, '2024-06-01', 'John Doe', 'Login Page', 'Users cannot log in', '2024-06-10', 'High', 'Open', 'Jane Smith', 'Investigating issue', NULL), (asdf, asdf, asdf, asdf);





